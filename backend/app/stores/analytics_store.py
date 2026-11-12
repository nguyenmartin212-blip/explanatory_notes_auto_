"""Persistence for anonymous analytics sessions, events and QR codes."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError

QR = "qr_codes"
SESSIONS = "analytics_sessions"
EVENTS = "analytics_events"
PUBLIC = {"_id": 0}


async def ensure_indexes(db):
    await db[QR].create_index("code", unique=True)
    await db[QR].create_index("qr_id", unique=True)
    await db[SESSIONS].create_index("session_id", unique=True)
    await db[SESSIONS].create_index("last_seen")
    await db[SESSIONS].create_index("started_at")
    await db[EVENTS].create_index([("event_type", 1), ("poi_id", 1)])


async def start_session(db, device_id, lang_code, device_type, qr):
    now = datetime.now(timezone.utc)
    session = {
        "session_id": uuid4().hex,
        "device_id": device_id,
        "lang_code": lang_code,
        "device_type": device_type,
        "started_at": now,
        "last_seen": now,
        "qr_id": qr["qr_id"] if qr else None,
        "qr_label": qr["label"] if qr else None,
        "poi_id": qr.get("poi_id") if qr else None,
    }
    await db[SESSIONS].insert_one(dict(session))
    return session


async def active_qr(db, code):
    return await db[QR].find_one({"code": code, "is_active": True}, PUBLIC)


async def heartbeat(db, session_id):
    updated = await db[SESSIONS].update_one(
        {"session_id": session_id}, {"$max": {"last_seen": datetime.now(timezone.utc)}}
    )
    if not updated.matched_count:
        raise NotFoundError("Phiên truy cập không tồn tại")


async def add_event(db, payload):
    if not await db[SESSIONS].find_one({"session_id": payload["session_id"]}, {"_id": 1}):
        raise NotFoundError("Phiên truy cập không tồn tại")
    await db[EVENTS].insert_one({**payload, "created_at": datetime.now(timezone.utc)})


async def online_now(db):
    threshold = datetime.now(timezone.utc) - timedelta(seconds=90)
    devices = await db[SESSIONS].aggregate([
        {"$match": {"last_seen": {"$gte": threshold}}},
        {"$group": {"_id": "$device_id"}},
        {"$count": "total"},
    ]).to_list(length=1)
    return devices[0]["total"] if devices else 0


async def group_counts(collection, match, group, limit=None):
    pipeline = [
        {"$match": match},
        {"$group": {"_id": group, "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    if limit:
        pipeline.append({"$limit": limit})
    return await collection.aggregate(pipeline).to_list(length=limit)


async def daily_counts(db, first_day, match, unique_devices=False):
    day = {"$dateToString": {"format": "%Y-%m-%d", "date": "$started_at"}}
    group = {"date": day, "device": "$device_id"} if unique_devices else day
    pipeline = [{"$match": {"started_at": {"$gte": first_day}, **match}}]
    if unique_devices:
        pipeline.append({"$group": {"_id": group}})
        group = "$_id.date"
    pipeline.append({"$group": {"_id": group, "count": {"$sum": 1}}})
    rows = await db[SESSIONS].aggregate(pipeline).to_list(length=None)
    counts = {row["_id"]: row["count"] for row in rows}
    return [
        {"date": (first_day + timedelta(days=offset)).date().isoformat(),
         "count": counts.get((first_day + timedelta(days=offset)).date().isoformat(), 0)}
        for offset in range(7)
    ]


async def distinct_visitors(db):
    rows = await db[SESSIONS].aggregate([
        {"$group": {"_id": "$device_id"}},
        {"$count": "total"},
    ]).to_list(length=1)
    return rows[0]["total"] if rows else 0


async def list_qr(db, offset, limit):
    return await db[QR].find({}, PUBLIC).sort("code", 1).skip(offset).limit(limit).to_list(limit)


async def create_qr(db, payload):
    qr = {"qr_id": uuid4().hex, **payload}
    try:
        await db[QR].insert_one(dict(qr))
    except DuplicateKeyError as exc:
        raise ConflictError("Mã QR đã tồn tại") from exc
    return qr


async def update_qr(db, qr_id, fields):
    query = {"qr_id": qr_id}
    qr = await db[QR].find_one_and_update(
        query, {"$set": fields}, return_document=ReturnDocument.AFTER, projection=PUBLIC
    ) if fields else await db[QR].find_one(query, PUBLIC)
    if not qr:
        raise NotFoundError("Mã QR không tồn tại")
    return qr


async def delete_qr(db, qr_id):
    result = await db[QR].delete_one({"qr_id": qr_id})
    if not result.deleted_count:
        raise NotFoundError("Mã QR không tồn tại")
