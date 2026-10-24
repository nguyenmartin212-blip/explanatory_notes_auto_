"""Store layer for anonymous visitor check-in sessions."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from app.db.collections import VISITOR_VISITS

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase

VISIT_RETENTION_DAYS = 90


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[VISITOR_VISITS].create_index("visit_id", unique=True)
    await db[VISITOR_VISITS].create_index([("poi_id", 1), ("entered_at", -1)])
    await db[VISITOR_VISITS].create_index(
        "entered_at",
        expireAfterSeconds=VISIT_RETENTION_DAYS * 24 * 60 * 60,
        name="visitor_visit_retention_ttl",
    )


async def check_in(
    db: AsyncIOMotorDatabase,
    *,
    visit_id: str,
    poi_id: str,
    at: datetime,
) -> dict:
    from pymongo import ReturnDocument

    return await db[VISITOR_VISITS].find_one_and_update(
        {"visit_id": visit_id},
        {
            "$setOnInsert": {
                "visit_id": visit_id,
                "poi_id": poi_id,
                "entered_at": at,
                "status": "inside",
            }
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


async def check_out(
    db: AsyncIOMotorDatabase,
    *,
    visit_id: str,
    at: datetime,
    exit_method: str = "manual",
) -> dict | None:
    from pymongo import ReturnDocument

    return await db[VISITOR_VISITS].find_one_and_update(
        {"visit_id": visit_id, "status": "inside"},
        {"$set": {"status": "exited", "exited_at": at, "exit_method": exit_method}},
        return_document=ReturnDocument.AFTER,
    )


async def get_by_visit_id(db: AsyncIOMotorDatabase, visit_id: str) -> dict | None:
    return await db[VISITOR_VISITS].find_one({"visit_id": visit_id})


async def list_visits(
    db: AsyncIOMotorDatabase,
    *,
    limit: int,
    offset: int,
    poi_id: str | None = None,
) -> tuple[list[dict], int]:
    query = {"poi_id": poi_id} if poi_id else {}
    cursor = (
        db[VISITOR_VISITS]
        .find(query, {"_id": 0})
        .sort("entered_at", -1)
        .skip(offset)
        .limit(limit)
    )
    visits = await cursor.to_list(length=limit)
    total = await db[VISITOR_VISITS].count_documents(query)
    return visits, total


async def save_itinerary(
    db: AsyncIOMotorDatabase,
    *,
    visit_id: str,
    poi_ids: list[str],
    at: datetime,
) -> dict | None:
    from pymongo import ReturnDocument

    return await db[VISITOR_VISITS].find_one_and_update(
        {"visit_id": visit_id},
        {"$set": {"saved_itinerary": {"poi_ids": poi_ids, "saved_at": at}}},
        return_document=ReturnDocument.AFTER,
    )


async def clear_itinerary(
    db: AsyncIOMotorDatabase,
    *,
    visit_id: str,
) -> dict | None:
    from pymongo import ReturnDocument

    return await db[VISITOR_VISITS].find_one_and_update(
        {"visit_id": visit_id},
        {"$unset": {"saved_itinerary": ""}},
        return_document=ReturnDocument.AFTER,
    )


async def delete_by_visit_id(db: AsyncIOMotorDatabase, visit_id: str) -> bool:
    result = await db[VISITOR_VISITS].delete_one({"visit_id": visit_id})
    return result.deleted_count == 1
