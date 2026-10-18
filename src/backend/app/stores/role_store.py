"""Store layer: only talks to the `roles` collection.

Document shape: name, description, permissions (list, or ["*"] for super_admin),
is_default, created_at, updated_at
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from app.core.errors import ConflictError
from app.db.collections import ROLES

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase

_NO_ID = {"_id": 0}


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[ROLES].create_index("name", unique=True)


async def insert_missing_roles(db: AsyncIOMotorDatabase, roles: list[dict]) -> int:
    """Insert roles that do not exist yet; never overwrite existing ones."""
    now = datetime.now(timezone.utc)
    created = 0
    for role in roles:
        result = await db[ROLES].update_one(
            {"name": role["name"]},
            {"$setOnInsert": {**role, "created_at": now, "updated_at": now}},
            upsert=True,
        )
        if result.upserted_id is not None:
            created += 1
    return created


async def get(db: AsyncIOMotorDatabase, name: str) -> dict | None:
    return await db[ROLES].find_one({"name": name}, _NO_ID)


async def list_all(db: AsyncIOMotorDatabase) -> list[dict]:
    return await db[ROLES].find({}, _NO_ID).sort("name", 1).to_list(length=None)


async def create(db: AsyncIOMotorDatabase, doc: dict) -> None:
    from pymongo.errors import DuplicateKeyError

    now = datetime.now(timezone.utc)
    try:
        await db[ROLES].insert_one({**doc, "created_at": now, "updated_at": now})
    except DuplicateKeyError as exc:
        raise ConflictError(f"Role '{doc['name']}' already exists") from exc


async def update(db: AsyncIOMotorDatabase, name: str, fields: dict) -> bool:
    result = await db[ROLES].update_one(
        {"name": name}, {"$set": {**fields, "updated_at": datetime.now(timezone.utc)}}
    )
    return result.matched_count > 0


async def delete(db: AsyncIOMotorDatabase, name: str) -> bool:
    result = await db[ROLES].delete_one({"name": name})
    return result.deleted_count > 0
