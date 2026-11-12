"""Authenticated device heartbeat and usage report endpoints."""

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth.context import AuthContext
from app.auth.dependencies import get_auth_context, require_permission
from app.services import device_usage_service
from app.stores import device_usage_store

router = APIRouter(prefix="/api/analytics", tags=["device usage"])
DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"


class DeviceHeartbeat(BaseModel):
    device_id: str = Field(pattern=r"^[a-zA-Z0-9._:-]{1,128}$")
    device_name: str | None = None


@router.post("/devices/heartbeat")
async def heartbeat(
    data: DeviceHeartbeat, request: Request, ctx: AuthContext = Depends(get_auth_context)
):
    name = (data.device_name or "").strip()[:100] or "Thiết bị không tên"
    result = await device_usage_store.record_heartbeat(
        request.app.state.db, user_id=ctx.user_id, device_id=data.device_id,
        device_name=name, now=datetime.now(timezone.utc),
    )
    return {"ok": True, **result}


@router.get("/usage", dependencies=[Depends(require_permission("analytics:read"))])
async def usage(
    request: Request,
    period: device_usage_store.Period = "day",
    from_date: Annotated[str | None, Query(alias="from", pattern=DATE_PATTERN)] = None,
    to_date: Annotated[str | None, Query(alias="to", pattern=DATE_PATTERN)] = None,
):
    try:
        return await device_usage_service.usage_report(
            request.app.state.db, period=period,
            from_day=date.fromisoformat(from_date) if from_date else None,
            to_day=date.fromisoformat(to_date) if to_date else None,
            now=datetime.now(timezone.utc),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
