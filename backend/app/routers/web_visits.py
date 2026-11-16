"""Browser POI and visitor routes backed by the edit branch's SQL database."""
from datetime import timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import AppError
from app.database import get_db, has_tables
from app.models import POI
from app.models.web import PoiWebId, WebVisit
from app.routers.web_auth import require_web_permission
from app.services import localization_service
from app.stores.audio_task_store import utc_now

router = APIRouter(tags=["Web visitors"])
PoiKey = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{1,80}$")]


def resolve_poi(db, key):
    alias = db.get(PoiWebId, key) if has_tables(db, "poi_web_ids") else None
    poi_id = alias.poi_id if alias else (int(key[4:]) if key.startswith("poi-") and key[4:].isdigit()
                                       and len(key) <= 14 else None)
    poi = db.get(POI, poi_id) if poi_id else None
    if not poi or not poi.is_active:
        raise AppError(404, "Điểm tham quan không tồn tại hoặc chưa công khai")
    return poi


@router.get("/pois")
def pois(db: Session = Depends(get_db), lang: str = Query("vi", max_length=10)):
    query = select(POI).where(POI.is_active.is_(True)).order_by(POI.audio_priority.desc(), POI.id)
    query = query.options(selectinload(POI.localizations), selectinload(POI.images), selectinload(POI.region))
    aliases = dict(db.execute(select(PoiWebId.poi_id, PoiWebId.slug)).all()) if has_tables(db, "poi_web_ids") else {}
    return [{
        "id": aliases.get(poi.id, f"poi-{poi.id}"),
        "backendId": poi.id,
        "regionCode": poi.region.code,
        "content": localization_service.pick_content(
            poi, {(poi.id, loc.lang_code): loc for loc in poi.localizations}, lang,
        ),
        "requestedLanguage": lang,
        "name": {**{loc.lang_code: loc.name for loc in poi.localizations}, "vi": poi.name_vi},
        "description": {**{loc.lang_code: loc.description for loc in poi.localizations},
                        "vi": poi.description_vi},
        "ttsScript": {**{loc.lang_code: loc.description for loc in poi.localizations},
                      "vi": poi.description_vi},
        "audio": {loc.lang_code: url for loc in poi.localizations
                  if (url := localization_service.ready_audio(loc))},
        "latitude": poi.latitude, "longitude": poi.longitude,
        "radiusMeters": poi.trigger_radius, "priority": poi.audio_priority,
        "images": list(dict.fromkeys(
            ([poi.cover_image_url] if poi.cover_image_url else []) +
            [img.image_url for img in sorted(poi.images, key=lambda image: image.sort_order)]
        )),
    } for poi in db.scalars(query)]


def require_visit_table(db: Session = Depends(get_db)):
    if not has_tables(db, "web_visits"):
        raise AppError(503, "Schema hiện tại chưa lưu check-in và lộ trình Web.")


class CheckIn(BaseModel):
    visit_id: UUID
    poi_id: PoiKey


class CheckOut(BaseModel):
    visit_id: UUID
    exit_method: Literal["manual", "geofence"] = "manual"


class Itinerary(BaseModel):
    visit_id: UUID
    poi_ids: list[PoiKey] = Field(min_length=1, max_length=20)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value else None


def visit_view(visit):
    return {"visit_id": visit.visit_id, "poi_id": visit.poi_id,
            "status": "exited" if visit.exited_at else "inside",
            "entered_at": utc(visit.entered_at), "exited_at": utc(visit.exited_at),
            "exit_method": visit.exit_method, "saved_itinerary": visit.saved_itinerary}


def get_visit(db, key):
    visit = db.get(WebVisit, str(key), with_for_update=True)
    if visit is None:
        raise AppError(404, "Không tìm thấy lượt ghé")
    return visit


@router.post("/api/visitors/check-in", dependencies=[Depends(require_visit_table)])
def check_in(data: CheckIn, db: Session = Depends(get_db)):
    key = str(data.visit_id)
    visit = db.get(WebVisit, key)
    if visit is None:
        resolve_poi(db, data.poi_id)
        visit = WebVisit(visit_id=key, poi_id=data.poi_id, entered_at=utc_now())
        db.add(visit)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            visit = get_visit(db, key)
    if visit.poi_id != data.poi_id:
        raise AppError(409, "Lượt ghé đã thuộc điểm tham quan khác")
    return visit_view(visit)


@router.post("/api/visitors/check-out", dependencies=[Depends(require_visit_table)])
def check_out(data: CheckOut, db: Session = Depends(get_db)):
    visit = get_visit(db, data.visit_id)
    if visit.exited_at is None:
        visit.exited_at, visit.exit_method = utc_now(), data.exit_method
        db.commit()
    return visit_view(visit)


@router.post("/api/visitors/itinerary", dependencies=[Depends(require_visit_table)])
def save_itinerary(data: Itinerary, db: Session = Depends(get_db)):
    if len(set(data.poi_ids)) != len(data.poi_ids):
        raise AppError(422, "Lộ trình chứa điểm bị trùng")
    for key in data.poi_ids:
        resolve_poi(db, key)
    visit = get_visit(db, data.visit_id)
    visit.saved_itinerary = {"poi_ids": data.poi_ids, "saved_at": utc(utc_now()).isoformat()}
    db.commit()
    return visit_view(visit)


@router.delete("/api/visitors/itinerary/{visit_id}", dependencies=[Depends(require_visit_table)])
def clear_itinerary(visit_id: UUID, db: Session = Depends(get_db)):
    visit = get_visit(db, visit_id)
    visit.saved_itinerary = None
    db.commit()
    return visit_view(visit)


@router.delete("/api/visitors/{visit_id}", dependencies=[Depends(require_visit_table)])
def delete_visit(visit_id: UUID, db: Session = Depends(get_db)):
    visit = get_visit(db, visit_id)
    db.delete(visit)
    db.commit()
    return {"deleted": True}


@router.get("/admin/visitor-visits", dependencies=[Depends(require_web_permission("visitor:read")), Depends(require_visit_table)])
def list_visits(db: Session = Depends(get_db), poi_id: PoiKey | None = None,
                limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0)):
    query = select(WebVisit)
    if poi_id:
        query = query.where(WebVisit.poi_id == poi_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(WebVisit.entered_at.desc(), WebVisit.visit_id).offset(offset).limit(limit))
    return {"items": [visit_view(visit) for visit in rows], "total": total, "limit": limit, "offset": offset}
