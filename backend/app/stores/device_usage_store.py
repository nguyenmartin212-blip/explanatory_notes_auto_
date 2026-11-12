"""Device presence and usage history for authenticated accounts."""

from datetime import datetime, timedelta
from typing import Literal

from pymongo.errors import DuplicateKeyError

from app.db.collections import DEVICE_PRESENCE, DEVICE_USAGE_SESSIONS

SESSION_IDLE = timedelta(minutes=30)
Period = Literal["day", "month"]


async def ensure_indexes(db) -> None:
    await db[DEVICE_PRESENCE].create_index([("user_id", 1), ("device_id", 1)], unique=True)
    await db[DEVICE_PRESENCE].create_index([("last_seen_at", -1)])
    await db[DEVICE_USAGE_SESSIONS].create_index([("started_at", -1)])
    await db[DEVICE_USAGE_SESSIONS].create_index([("user_id", 1), ("device_id", 1), ("started_at", -1)])


async def record_heartbeat(
    db, *, user_id: str, device_id: str, device_name: str, now: datetime
) -> dict:
    key = {"user_id": user_id, "device_id": device_id}
    presence = db[DEVICE_PRESENCE]

    async def record(session):
        previous = await presence.find_one(key, {"last_seen_at": 1}, session=session)
        last_seen = previous["last_seen_at"] if previous else None
        seen_at = max(now, last_seen) if last_seen else now
        starts_session = last_seen is None or seen_at - last_seen > SESSION_IDLE
        await presence.update_one(
            key, {"$set": {"device_name": device_name, "last_seen_at": seen_at}},
            upsert=True, session=session,
        )
        if starts_session:
            await db[DEVICE_USAGE_SESSIONS].insert_one(
                {**key, "device_name": device_name, "started_at": seen_at}, session=session
            )
        return {"device_id": device_id, "device_name": device_name,
                "last_seen_at": seen_at, "session_started": starts_session}

    async with await db.client.start_session() as session:
        try:
            return await session.with_transaction(record)
        except DuplicateKeyError:
            # Concurrent first upserts may race on the unique device key.
            return await session.with_transaction(record)


async def list_active_devices(db, cutoff: datetime) -> list[dict]:
    return await db[DEVICE_PRESENCE].find(
        {"last_seen_at": {"$gte": cutoff}},
        {"_id": 0, "user_id": 1, "device_id": 1, "device_name": 1, "last_seen_at": 1},
    ).sort([("last_seen_at", -1), ("user_id", 1), ("device_id", 1)]).to_list(length=None)


async def count_sessions(db, start: datetime, end: datetime, period: Period) -> list[dict]:
    date_format = "%Y-%m" if period == "month" else "%Y-%m-%d"
    rows = await db[DEVICE_USAGE_SESSIONS].aggregate([
        {"$match": {"started_at": {"$gte": start, "$lt": end}}},
        {"$group": {
            "_id": {
                "period": {"$dateToString": {"format": date_format, "date": "$started_at"}},
                "user_id": "$user_id",
                "device_id": "$device_id",
            },
            "sessions": {"$sum": 1},
        }},
        {"$group": {
            "_id": "$_id.period", "sessions": {"$sum": "$sessions"}, "uniqueDevices": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
        {"$project": {"_id": 0, "period": "$_id", "sessions": 1, "uniqueDevices": 1}},
    ]).to_list(length=None)
    return rows
