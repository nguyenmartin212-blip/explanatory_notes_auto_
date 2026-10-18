"""Store layer: only talks to the `POI` collection.

Document shape:
    poi_id, status ("draft" | "active"), location (GeoJSON Point, [lng, lat]),
    radius_meters, priority, images, map_url, dataset_version (set when public),
    created_at, updated_at, activated_at
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from app.core.errors import ConflictError, GeoQueryUnavailable
from app.db.collections import POI

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase

STATUS_DRAFT = "draft"
STATUS_ACTIVE = "active"


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[POI].create_index("poi_id", unique=True)
    await db[POI].create_index([("location", "2dsphere")])
    await db[POI].create_index([("status", 1), ("dataset_version", 1)])
    await db[POI].create_index([("status", 1), ("updated_at", 1)])


async def insert(db: AsyncIOMotorDatabase, doc: dict) -> None:
    from pymongo.errors import DuplicateKeyError

    try:
        await db[POI].insert_one(dict(doc))
    except DuplicateKeyError as exc:
        raise ConflictError(f"POI '{doc['poi_id']}' already exists") from exc


async def get(db: AsyncIOMotorDatabase, poi_id: str) -> dict | None:
    return await db[POI].find_one({"poi_id": poi_id}, {"_id": 0})


async def update_fields(db: AsyncIOMotorDatabase, poi_id: str, fields: dict) -> bool:
    result = await db[POI].update_one({"poi_id": poi_id}, {"$set": fields})
    return result.matched_count > 0


async def delete(db: AsyncIOMotorDatabase, poi_id: str) -> bool:
    result = await db[POI].delete_one({"poi_id": poi_id})
    return result.deleted_count > 0


async def list_active(db: AsyncIOMotorDatabase) -> list[dict]:
    cursor = db[POI].find({"status": STATUS_ACTIVE}, {"_id": 0})
    return await cursor.to_list(length=None)


async def list_active_since_version(db: AsyncIOMotorDatabase, version: int) -> list[dict]:
    cursor = db[POI].find({"status": STATUS_ACTIVE, "dataset_version": {"$gt": version}}, {"_id": 0})
    return await cursor.to_list(length=None)


async def list_active_updated_after(db: AsyncIOMotorDatabase, after: datetime) -> list[dict]:
    cursor = db[POI].find({"status": STATUS_ACTIVE, "updated_at": {"$gt": after}}, {"_id": 0})
    return await cursor.to_list(length=None)


async def geo_near(
    db: AsyncIOMotorDatabase, *, lat: float, lng: float, max_distance_m: float, limit: int
) -> list[tuple[dict, float]]:
    """Active POIs within `max_distance_m`, nearest first, via $geoNear.

    Raises GeoQueryUnavailable if MongoDB cannot run the query (the caller
    then falls back to Haversine).
    """
    from pymongo.errors import PyMongoError

    pipeline = [
        {
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "distanceField": "distance_m",
                "maxDistance": float(max_distance_m),
                "spherical": True,
                "query": {"status": STATUS_ACTIVE},
            }
        },
        {"$limit": limit},
        {"$project": {"_id": 0}},
    ]
    try:
        docs = await db[POI].aggregate(pipeline).to_list(length=limit)
    except PyMongoError as exc:
        raise GeoQueryUnavailable(str(exc)) from exc
    return [(doc, float(doc.pop("distance_m"))) for doc in docs]
