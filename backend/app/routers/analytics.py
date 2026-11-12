"""Anonymous visitor analytics and authenticated reporting/QR administration."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth.context import AuthContext
from app.auth.dependencies import require_permission
from app.routers.admin import require_admin_content_permission
from app.stores import analytics_store as store
from app.stores import audit_log_store, poi_localization_store, poi_store
from app.services import rate_limiter

router = APIRouter(prefix="/api/v1", tags=["analytics and QR"])
Language = Literal["vi", "en", "zh", "ja", "ko"]
Code = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{2,100}$")]
PoiId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{1,80}$")]


class SessionIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    device_id: str = Field(min_length=1, max_length=100)
    device_type: str | None = Field(default=None, max_length=40)
    lang_code: Language = "vi"
    qr_code: Code | None = None


class SessionKey(BaseModel):
    session_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class EventIn(SessionKey):
    event_type: Literal["view_poi", "play_audio", "finish_audio", "change_lang", "qr_scan"]
    poi_id: PoiId | None = None
    lang_code: Language | None = None


class QrCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    code: Code
    label: str = Field(min_length=1, max_length=150)
    poi_id: PoiId | None = None
    is_active: bool = True


class QrUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    label: str | None = Field(default=None, min_length=1, max_length=150)
    poi_id: PoiId | None = None
    is_active: bool | None = None


async def limit_public(request: Request):
    client = request.client.host if request.client else "unknown"
    await rate_limiter.check(request.app.state.redis, "visitor-analytics", client,
                             limit=300, window_seconds=60)


@router.post("/analytics/session", status_code=201, dependencies=[Depends(limit_public)])
async def start_session(data: SessionIn, request: Request):
    db = request.app.state.db
    qr = await store.active_qr(db, data.qr_code) if data.qr_code else None
    session = await store.start_session(db, data.device_id, data.lang_code, data.device_type, qr)
    poi = await poi_store.get(db, session["poi_id"]) if session["poi_id"] else None
    return {
        "session_id": session["session_id"],
        "qr_id": session["qr_id"],
        "poi_id": poi["poi_id"] if poi and poi["status"] == poi_store.STATUS_ACTIVE else None,
    }


@router.post("/analytics/heartbeat", dependencies=[Depends(limit_public)])
async def heartbeat(data: SessionKey, request: Request):
    await store.heartbeat(request.app.state.db, data.session_id)
    return {"detail": "OK"}


@router.post("/analytics/event", status_code=201, dependencies=[Depends(limit_public)])
async def add_event(data: EventIn, request: Request):
    await store.add_event(request.app.state.db, data.model_dump())
    return {"detail": "OK"}


@router.get("/admin/stats/online", dependencies=[Depends(require_permission("analytics:read"))])
async def online(request: Request):
    return {"online_now": await store.online_now(request.app.state.db)}


@router.get("/admin/stats/summary", dependencies=[Depends(require_permission("analytics:read"))])
async def summary(request: Request):
    db = request.app.state.db
    sessions = db[store.SESSIONS]
    events = db[store.EVENTS]
    first_day = (datetime.now(timezone.utc) - timedelta(days=6)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    qr_match = {"qr_id": {"$type": "string"}}
    online_count, total, visitors, scans, daily_scans, daily_visitors, views, plays, languages, qrs = (
        await asyncio.gather(
            store.online_now(db),
            sessions.count_documents({}),
            store.distinct_visitors(db),
            sessions.count_documents(qr_match),
            store.daily_counts(db, first_day, qr_match),
            store.daily_counts(db, first_day, {}, unique_devices=True),
            store.group_counts(events, {"event_type": "view_poi", "poi_id": {"$type": "string"}}, "$poi_id", 10),
            store.group_counts(events, {"event_type": "play_audio", "poi_id": {"$type": "string"}}, "$poi_id", 10),
            store.group_counts(sessions, {}, "$lang_code"),
            store.group_counts(sessions, qr_match, "$qr_label", 10),
        )
    )
    ids = sorted({row["_id"] for row in views + plays})
    locs = await poi_localization_store.list_for_pois(db, ids)

    def ranked(rows):
        return [
            {"poi_id": row["_id"], "name": locs.get(row["_id"], {}).get("vi", {}).get("name", row["_id"]),
             "count": row["count"]}
            for row in rows
        ]

    return {
        "online_now": online_count,
        "total_sessions": total,
        "unique_visitors": visitors,
        "total_qr_scans": scans,
        "scans_last_7_days": daily_scans,
        "visitors_last_7_days": daily_visitors,
        "top_pois_by_views": ranked(views),
        "top_pois_by_plays": ranked(plays),
        "languages": [{"lang_code": row["_id"], "count": row["count"]} for row in languages],
        "qr_ranking": [{"label": row["_id"], "count": row["count"]} for row in qrs],
    }


async def audit(db, ctx, action, qr_id):
    await audit_log_store.insert(
        db, action=action, actor_id=ctx.user_id, target_id=qr_id, details=None, at=datetime.now(timezone.utc)
    )


async def validate_poi(db, poi_id):
    if poi_id and not await poi_store.get(db, poi_id):
        raise HTTPException(422, "Điểm tham quan không tồn tại")


@router.get("/admin/qr", dependencies=[Depends(require_admin_content_permission("poi:read_draft"))])
async def list_qr(request: Request, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    return await store.list_qr(request.app.state.db, offset, limit)


@router.post("/admin/qr", status_code=201)
async def create_qr(data: QrCreate, request: Request, ctx: AuthContext = Depends(require_admin_content_permission("poi:activate"))):
    db = request.app.state.db
    await validate_poi(db, data.poi_id)
    qr = await store.create_qr(db, data.model_dump())
    await audit(db, ctx, "qr.create", qr["qr_id"])
    return qr


@router.patch("/admin/qr/{qr_id}")
async def update_qr(
    qr_id: str, data: QrUpdate, request: Request, ctx: AuthContext = Depends(require_admin_content_permission("poi:activate"))
):
    db = request.app.state.db
    await validate_poi(db, data.poi_id)
    fields = {key: value for key, value in data.model_dump(exclude_unset=True).items()
              if value is not None or key == "poi_id"}
    qr = await store.update_qr(db, qr_id, fields)
    await audit(db, ctx, "qr.update", qr_id)
    return qr


@router.delete("/admin/qr/{qr_id}", status_code=204)
async def delete_qr(qr_id: str, request: Request, ctx: AuthContext = Depends(require_admin_content_permission("poi:activate"))):
    db = request.app.state.db
    await store.delete_qr(db, qr_id)
    await audit(db, ctx, "qr.delete", qr_id)
    return Response(status_code=204)
