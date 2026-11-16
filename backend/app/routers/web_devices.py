"""Authenticated device usage from the Web dashboard, using MySQL transactions."""
from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.database import get_db, has_tables
from app.models import AdminUser
from app.models.web import DevicePresence, DeviceUsageSession
from app.routers.web_auth import current_user, require_web_permission
from app.routers.web_visits import utc
from app.stores.audio_task_store import utc_now

router = APIRouter(prefix="/api/analytics", tags=["Web device usage"])


class Heartbeat(BaseModel):
    device_id: str = Field(pattern=r"^[a-zA-Z0-9._:-]{1,128}$")
    device_name: str = Field(default="Trình duyệt Web", max_length=100)


@router.post("/devices/heartbeat")
def heartbeat(data: Heartbeat, db: Session = Depends(get_db), user=Depends(current_user)):
    if not has_tables(db, "web_device_presence", "web_device_usage_sessions"):
        raise AppError(503, "Schema hiện tại chưa có bảng thống kê thiết bị quản trị.")
    # Serialize heartbeats for the same account, including first-time device inserts.
    db.execute(select(AdminUser.id).where(AdminUser.id == user.id).with_for_update()).one()
    key = (user.id, data.device_id)
    device = db.get(DevicePresence, key, with_for_update=True)
    now = utc_now()
    started = device is None or now - device.last_seen_at > timedelta(minutes=30)
    if device is None:
        device = DevicePresence(user_id=user.id, device_id=data.device_id)
        db.add(device)
    device.device_name = data.device_name.strip() or "Thiết bị không tên"
    device.last_seen_at = max(now, device.last_seen_at or now)
    if started:
        db.add(DeviceUsageSession(user_id=user.id, device_id=data.device_id, started_at=device.last_seen_at))
    db.commit()
    return {"ok": True, "device_id": device.device_id, "device_name": device.device_name,
            "last_seen_at": utc(device.last_seen_at), "session_started": started}


@router.get("/usage", dependencies=[Depends(require_web_permission("analytics:read"))])
def usage(db: Session = Depends(get_db), period: Literal["day", "month"] = "day",
          from_day: Annotated[str | None, Query(alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$")] = None,
          to_day: Annotated[str | None, Query(alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$")] = None):
    if not has_tables(db, "web_device_presence", "web_device_usage_sessions"):
        raise AppError(503, "Schema hiện tại chưa có bảng thống kê thiết bị quản trị.")
    now = utc_now()
    try:
        if bool(from_day) != bool(to_day):
            raise ValueError
        if from_day:
            start, end = date.fromisoformat(from_day), date.fromisoformat(to_day)
        else:
            end = now.date()
            year, month = divmod(end.year * 12 + end.month - 12, 12)
            start = date(year, month + 1, 1) if period == "month" else end - timedelta(days=29)
        if end < start or end == date.max:
            raise ValueError
    except ValueError as exc:
        raise AppError(422, "Khoảng ngày không hợp lệ") from exc

    active = db.scalars(select(DevicePresence)
                        .where(DevicePresence.last_seen_at >= now - timedelta(minutes=2))
                        .order_by(DevicePresence.last_seen_at.desc())).all()
    sessions = db.execute(select(DeviceUsageSession.user_id, DeviceUsageSession.device_id,
                                 DeviceUsageSession.started_at).where(
        DeviceUsageSession.started_at >= datetime.combine(start, time.min),
        DeviceUsageSession.started_at < datetime.combine(end + timedelta(days=1), time.min),
    ))
    counts, unique = {}, {}
    for user_id, device_id, when in sessions:
        key = when.strftime("%Y-%m" if period == "month" else "%Y-%m-%d")
        counts[key] = counts.get(key, 0) + 1
        unique.setdefault(key, set()).add((user_id, device_id))
    return {
        "generated_at": utc(now), "timezone": "UTC", "active_device_count": len(active),
        "active_devices": [{"user_id": str(d.user_id), "device_id": d.device_id,
                            "device_name": d.device_name, "last_seen_at": utc(d.last_seen_at)} for d in active],
        "period": period, "from": start, "to": end, "total_sessions": sum(counts.values()),
        "usage": [{"period": key, "sessions": counts[key], "uniqueDevices": len(unique[key])}
                  for key in sorted(counts)],
    }
