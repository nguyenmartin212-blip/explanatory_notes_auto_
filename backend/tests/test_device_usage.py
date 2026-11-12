"""MongoDB transaction and UTC reporting coverage for authenticated devices."""

import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from app.services.device_usage_service import report_range, usage_report
from app.stores import device_usage_store as store


def test_default_report_ranges_cross_calendar_boundaries():
    day_start, day_end = report_range("day", None, None, date(2026, 1, 10))
    assert (day_start.date(), day_end.date()) == (date(2025, 12, 12), date(2026, 1, 11))
    month_start, month_end = report_range("month", None, None, date(2026, 1, 10))
    assert (month_start.date(), month_end.date()) == (date(2025, 2, 1), date(2026, 1, 11))


@pytest.mark.asyncio
@pytest.mark.skipif(not os.getenv("TEST_MONGO_URI"), reason="requires a MongoDB replica set")
async def test_device_heartbeat_and_usage_with_concurrent_writes():
    client = AsyncIOMotorClient(os.environ["TEST_MONGO_URI"], tz_aware=True, serverSelectionTimeoutMS=5000)
    db = client[f"test_device_usage_{uuid4().hex}"]
    try:
        await store.ensure_indexes(db)
        start = datetime(2026, 10, 31, 23, 30, tzinfo=timezone.utc)

        async def heartbeat(now, user_id="admin-1"):
            return await store.record_heartbeat(
                db, user_id=user_id, device_id="same-browser", device_name="Web", now=now
            )

        first = await asyncio.gather(*(heartbeat(start) for _ in range(6)))
        assert sum(result["session_started"] for result in first) == 1
        boundary = start + timedelta(minutes=30)
        assert not (await heartbeat(boundary))["session_started"]

        after_idle = boundary + timedelta(minutes=30, seconds=1)
        later = await asyncio.gather(*(heartbeat(after_idle) for _ in range(6)))
        assert sum(result["session_started"] for result in later) == 1
        stale = await heartbeat(start)
        assert stale["last_seen_at"] == after_idle
        assert not stale["session_started"]
        assert (await heartbeat(after_idle, "admin-2"))["session_started"]

        daily = await usage_report(
            db, period="day", from_day=date(2026, 11, 1), to_day=date(2026, 11, 1),
            now=after_idle + timedelta(minutes=2),
        )
        assert daily["active_device_count"] == 2
        assert daily["total_sessions"] == 2
        assert daily["usage"] == [{"period": "2026-11-01", "sessions": 2, "uniqueDevices": 2}]

        repeat = after_idle + timedelta(minutes=31)
        assert (await heartbeat(repeat))["session_started"]
        monthly = await usage_report(
            db, period="month", from_day=None, to_day=None, now=repeat + timedelta(minutes=3)
        )
        assert monthly["active_device_count"] == 0
        assert monthly["total_sessions"] == 4
        assert monthly["usage"] == [
            {"period": "2026-10", "sessions": 1, "uniqueDevices": 1},
            {"period": "2026-11", "sessions": 3, "uniqueDevices": 2},
        ]
    finally:
        await client.drop_database(db.name)
        client.close()
