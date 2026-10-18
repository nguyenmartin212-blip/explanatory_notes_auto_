"""Store layer: only talks to the `poi_localizations` collection.

One document per (poi_id, language):
    poi_id, language, name, description, tts_script, content_hash,
    audio_status ("none" | "pending" | "ready" | "failed"),
    audio_url, audio_path, audio_hash, audio_error, updated_at
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from app.db.collections import POI_LOCALIZATIONS

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[POI_LOCALIZATIONS].create_index([("poi_id", 1), ("language", 1)], unique=True)


async def get(db: AsyncIOMotorDatabase, poi_id: str, language: str) -> dict | None:
    return await db[POI_LOCALIZATIONS].find_one({"poi_id": poi_id, "language": language}, {"_id": 0})


async def list_for_poi(db: AsyncIOMotorDatabase, poi_id: str) -> dict[str, dict]:
    docs = await db[POI_LOCALIZATIONS].find({"poi_id": poi_id}, {"_id": 0}).to_list(length=None)
    return {doc["language"]: doc for doc in docs}


async def list_for_pois(
    db: AsyncIOMotorDatabase, poi_ids: list[str]
) -> dict[str, dict[str, dict]]:
    if not poi_ids:
        return {}
    cursor = db[POI_LOCALIZATIONS].find({"poi_id": {"$in": poi_ids}}, {"_id": 0})
    result: dict[str, dict[str, dict]] = {}
    for doc in await cursor.to_list(length=None):
        result.setdefault(doc["poi_id"], {})[doc["language"]] = doc
    return result


async def upsert(db: AsyncIOMotorDatabase, doc: dict) -> None:
    await db[POI_LOCALIZATIONS].replace_one(
        {"poi_id": doc["poi_id"], "language": doc["language"]}, doc, upsert=True
    )


async def mark_audio_ready(
    db: AsyncIOMotorDatabase,
    *,
    poi_id: str,
    language: str,
    content_hash: str,
    audio_path: str,
    audio_url: str,
    now: datetime,
    audio_sha256: str | None = None,
    audio_size: int | None = None,
) -> bool:
    """Only succeeds if the text was not changed since the audio was requested."""
    result = await db[POI_LOCALIZATIONS].update_one(
        {"poi_id": poi_id, "language": language, "content_hash": content_hash},
        {
            "$set": {
                "audio_status": "ready",
                "audio_url": audio_url,
                "audio_path": audio_path,
                "audio_hash": content_hash,
                "audio_sha256": audio_sha256,
                "audio_size": audio_size,
                "audio_error": None,
                "updated_at": now,
            }
        },
    )
    return result.matched_count > 0


async def mark_audio_pending(
    db: AsyncIOMotorDatabase, *, poi_id: str, language: str, content_hash: str, now: datetime
) -> bool:
    """Failed -> pending when an admin retries the audio task."""
    result = await db[POI_LOCALIZATIONS].update_one(
        {"poi_id": poi_id, "language": language, "content_hash": content_hash, "audio_status": "failed"},
        {"$set": {"audio_status": "pending", "audio_error": None, "updated_at": now}},
    )
    return result.matched_count > 0


async def mark_audio_failed(
    db: AsyncIOMotorDatabase,
    *,
    poi_id: str,
    language: str,
    content_hash: str,
    error: str,
    now: datetime,
) -> bool:
    result = await db[POI_LOCALIZATIONS].update_one(
        {"poi_id": poi_id, "language": language, "content_hash": content_hash},
        {"$set": {"audio_status": "failed", "audio_error": error, "updated_at": now}},
    )
    return result.matched_count > 0


async def delete_for_poi(db: AsyncIOMotorDatabase, poi_id: str) -> int:
    result = await db[POI_LOCALIZATIONS].delete_many({"poi_id": poi_id})
    return result.deleted_count
