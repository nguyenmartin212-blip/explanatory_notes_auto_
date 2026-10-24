"""Store layer: only talks to the `audio_tasks` collection.

One task document per (poi_id, language):
    task_id, poi_id, language, text, source_lang, content_hash,
    status: queued | running | paused | completed | failed | cancelled
    stage, progress (0-100), error, attempts, rerun, cache_hit, result, audio_url,
    created_at, queued_at, started_at, finished_at, updated_at

`text` / `content_hash` are always the LATEST requested content. A worker holds
a snapshot taken when it claimed the task; if the content changes meanwhile,
`enqueue` sets `rerun` so the task is queued again when the worker finishes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Iterable

from app.db.collections import AUDIO_TASKS

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase

QUEUED = "queued"
RUNNING = "running"
PAUSED = "paused"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"

ALL_STATUSES = (QUEUED, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED)
TERMINAL_STATUSES = (COMPLETED, FAILED, CANCELLED)

_NO_ID = {"_id": 0}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    coll = db[AUDIO_TASKS]
    await coll.create_index([("status", 1), ("updated_at", 1)])
    await coll.create_index([("status", 1), ("queued_at", 1)])
    await coll.create_index([("poi_id", 1), ("language", 1)], unique=True)
    await coll.create_index("task_id", unique=True, sparse=True)
    await coll.create_index("updated_at")


async def enqueue(
    db: AsyncIOMotorDatabase,
    *,
    poi_id: str,
    language: str,
    text: str,
    content_hash: str,
    source_lang: str | None = None,
) -> str:
    """Queue audio generation for one language. Returns 'queued', 'rerun' or 'paused'.

    - running: keep running, flag `rerun` (the worker's result for the old text is
      rejected by the content_hash check and the task is queued again).
    - paused:  update the text but stay paused (an admin put it on hold).
    - other:   (re)queue.
    """
    now = _now()
    coll = db[AUDIO_TASKS]
    base = {
        "text": text,
        "content_hash": content_hash,
        "source_lang": source_lang or language,
        "updated_at": now,
    }
    key = {"poi_id": poi_id, "language": language}

    running = await coll.update_one({**key, "status": RUNNING}, {"$set": {**base, "rerun": True}})
    if running.matched_count:
        return "rerun"
    paused = await coll.update_one({**key, "status": PAUSED}, {"$set": base})
    if paused.matched_count:
        return "paused"

    await coll.update_one(
        key,
        {
            "$set": {
                **base,
                "status": QUEUED,
                "queued_at": now,
                "rerun": False,
                "stage": None,
                "progress": 0,
                "error": None,
                "cache_hit": None,
                "result": None,
            },
            "$setOnInsert": {"task_id": uuid.uuid4().hex, "created_at": now, "attempts": 0},
        },
        upsert=True,
    )
    return "queued"


async def get(db: AsyncIOMotorDatabase, task_id: str) -> dict | None:
    return await db[AUDIO_TASKS].find_one({"task_id": task_id}, _NO_ID)


async def claim_next(db: AsyncIOMotorDatabase) -> dict | None:
    """Atomically take the oldest queued task and mark it running."""
    from pymongo import ReturnDocument

    now = _now()
    return await db[AUDIO_TASKS].find_one_and_update(
        {"status": QUEUED},
        {
            "$set": {
                "status": RUNNING,
                "started_at": now,
                "updated_at": now,
                "stage": "starting",
                "progress": 0,
                "error": None,
            },
            "$inc": {"attempts": 1},
        },
        sort=[("queued_at", 1), ("_id", 1)],
        return_document=ReturnDocument.AFTER,
        projection=_NO_ID,
    )


async def set_progress(
    db: AsyncIOMotorDatabase, task_id: str, *, stage: str, progress: int, extra: dict | None = None
) -> bool:
    result = await db[AUDIO_TASKS].update_one(
        {"task_id": task_id, "status": RUNNING},
        {"$set": {"stage": stage, "progress": progress, "updated_at": _now(), **(extra or {})}},
    )
    return result.matched_count > 0


async def finalize(
    db: AsyncIOMotorDatabase, task_id: str, *, status: str, fields: dict | None = None
) -> dict | None:
    """Finish a running task. If its content changed while it ran (`rerun`), a
    completed/failed task goes back to the queue instead of finishing."""
    from pymongo import ReturnDocument

    coll = db[AUDIO_TASKS]
    current = await coll.find_one({"task_id": task_id}, _NO_ID)
    if current is None:
        return None
    now = _now()
    update = dict(fields or {})
    if current.get("rerun") and status in (COMPLETED, FAILED):
        update.update(status=QUEUED, queued_at=now, progress=0, stage=None, error=None)
    else:
        update["status"] = status
        if status in TERMINAL_STATUSES:
            update["finished_at"] = now
    update.update(rerun=False, updated_at=now)
    return await coll.find_one_and_update(
        {"task_id": task_id},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
        projection=_NO_ID,
    )


async def transition(
    db: AsyncIOMotorDatabase,
    task_id: str,
    *,
    from_statuses: Iterable[str],
    to_status: str,
    fields: dict | None = None,
) -> dict | None:
    """Conditional status change (admin actions). Returns the new document, or
    None if the task was not in one of `from_statuses`."""
    from pymongo import ReturnDocument

    now = _now()
    update = {"status": to_status, "updated_at": now, **(fields or {})}
    if to_status == QUEUED:
        update["queued_at"] = now
    if to_status in TERMINAL_STATUSES:
        update["finished_at"] = now
    return await db[AUDIO_TASKS].find_one_and_update(
        {"task_id": task_id, "status": {"$in": list(from_statuses)}},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
        projection=_NO_ID,
    )


async def list_recent(db: AsyncIOMotorDatabase, limit: int = 100) -> list[dict]:
    cursor = db[AUDIO_TASKS].find({}, _NO_ID).sort("updated_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def list_updated_since(db: AsyncIOMotorDatabase, since: datetime) -> list[dict]:
    cursor = db[AUDIO_TASKS].find({"updated_at": {"$gte": since}}, _NO_ID).sort("updated_at", 1)
    return await cursor.to_list(length=None)


async def delete_for_poi(db: AsyncIOMotorDatabase, poi_id: str) -> int:
    result = await db[AUDIO_TASKS].delete_many({"poi_id": poi_id})
    return result.deleted_count


async def requeue_all_running(db: AsyncIOMotorDatabase) -> int:
    """After a restart nothing is running in this process, so every 'running'
    task was interrupted and goes back to the queue. Paused tasks stay paused."""
    now = _now()
    result = await db[AUDIO_TASKS].update_many(
        {"status": RUNNING},
        {
            "$set": {
                "status": QUEUED,
                "queued_at": now,
                "updated_at": now,
                "recovered_at": now,
                "stage": None,
                "progress": 0,
            },
            "$inc": {"recovery_count": 1},
        },
    )
    return result.modified_count


async def requeue_stale_running(db: AsyncIOMotorDatabase, stale_seconds: int) -> int:
    """Requeue tasks stuck in 'running' longer than the lease time (progress
    updates refresh `updated_at`, so a healthy long task is not requeued)."""
    now = _now()
    cutoff = now - timedelta(seconds=stale_seconds)
    result = await db[AUDIO_TASKS].update_many(
        {"status": RUNNING, "updated_at": {"$lt": cutoff}},
        {
            "$set": {
                "status": QUEUED,
                "queued_at": now,
                "updated_at": now,
                "recovered_at": now,
                "stage": None,
                "progress": 0,
            },
            "$inc": {"recovery_count": 1},
        },
    )
    return result.modified_count
