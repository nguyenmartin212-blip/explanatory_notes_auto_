"""Report authenticated device presence and usage in UTC."""

import asyncio
from datetime import date, datetime, time, timedelta, timezone

from app.stores import device_usage_store as store

ACTIVE_WINDOW = timedelta(minutes=2)


def report_range(
    period: store.Period, from_day: date | None, to_day: date | None, today: date
) -> tuple[datetime, datetime]:
    if (from_day is None) != (to_day is None):
        raise ValueError("from and to must be supplied together")
    if from_day is None:
        to_day = today
        if period == "month":
            year, month_index = divmod(today.year * 12 + today.month - 12, 12)
            from_day = date(year, month_index + 1, 1)
        else:
            from_day = today - timedelta(days=29)
    if to_day < from_day:
        raise ValueError("to must be on or after from")
    if to_day == date.max:
        raise ValueError("to must be before 9999-12-31")
    return (
        datetime.combine(from_day, time.min, timezone.utc),
        datetime.combine(to_day + timedelta(days=1), time.min, timezone.utc),
    )


async def usage_report(
    db, *, period: store.Period, from_day: date | None, to_day: date | None, now: datetime
) -> dict:
    start, end = report_range(period, from_day, to_day, now.date())
    devices, usage = await asyncio.gather(
        store.list_active_devices(db, now - ACTIVE_WINDOW),
        store.count_sessions(db, start, end, period),
    )
    return {
        "generated_at": now,
        "timezone": "UTC",
        "active_device_count": len(devices),
        "active_devices": devices,
        "period": period,
        "from": start.date().isoformat(),
        "to": (end.date() - timedelta(days=1)).isoformat(),
        "usage": usage,
        "total_sessions": sum(row["sessions"] for row in usage),
    }
