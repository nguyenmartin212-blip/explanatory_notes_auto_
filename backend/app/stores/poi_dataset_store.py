"""Store layer: dataset version counter (`dataset_meta`) and tombstones (`poi_tombstones`).

`dataset_version` is a monotonic counter bumped on every change that clients
can see. Each public POI is stamped with the version of its last change, and
each deleted POI leaves a tombstone stamped the same way, so a client holding
version N can ask for "everything after N".
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from app.db.collections import DATASET_META, POI_TOMBSTONES

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase

POI_DATASET_ID = "poi_dataset"


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[POI_TOMBSTONES].create_index("poi_id", unique=True)
    await db[POI_TOMBSTONES].create_index("dataset_version")
    await db[POI_TOMBSTONES].create_index("deleted_at")


async def get_version(db: AsyncIOMotorDatabase) -> int:
    doc = await db[DATASET_META].find_one({"_id": POI_DATASET_ID})
    return int(doc["version"]) if doc else 0


async def bump_version(db: AsyncIOMotorDatabase) -> int:
    from pymongo import ReturnDocument

    doc = await db[DATASET_META].find_one_and_update(
        {"_id": POI_DATASET_ID},
        {"$inc": {"version": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc["version"])


async def add_tombstone(
    db: AsyncIOMotorDatabase, poi_id: str, version: int, deleted_at: datetime
) -> None:
    await db[POI_TOMBSTONES].replace_one(
        {"poi_id": poi_id},
        {"poi_id": poi_id, "dataset_version": version, "deleted_at": deleted_at},
        upsert=True,
    )


async def remove_tombstone(db: AsyncIOMotorDatabase, poi_id: str) -> None:
    await db[POI_TOMBSTONES].delete_one({"poi_id": poi_id})


async def tombstone_ids_since_version(db: AsyncIOMotorDatabase, version: int) -> list[str]:
    cursor = db[POI_TOMBSTONES].find({"dataset_version": {"$gt": version}}, {"_id": 0, "poi_id": 1})
    return [doc["poi_id"] for doc in await cursor.to_list(length=None)]


async def tombstone_ids_deleted_after(db: AsyncIOMotorDatabase, after: datetime) -> list[str]:
    cursor = db[POI_TOMBSTONES].find({"deleted_at": {"$gt": after}}, {"_id": 0, "poi_id": 1})
    return [doc["poi_id"] for doc in await cursor.to_list(length=None)]
