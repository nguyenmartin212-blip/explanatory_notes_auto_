"""Store layer: only talks to the `admin_users` collection (all account types).

Document shape:
    user_id, username (lower case), email, password_hash, role, is_active,
    token_version (bumped to invalidate every token of the user),
    is_poi_owner_verified, owner_status ("none" | "pending" | "verified" | "rejected"),
    owner_verified_at, owner_reviewed_at, owner_reviewed_by, owner_reject_reason,
    cccd_encrypted (Fernet token), cccd_masked, cccd_submitted_at, cccd_expires_at,
    cccd_hidden_at, created_at, updated_at, last_login_at
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from app.core.errors import ConflictError
from app.db.collections import ADMIN_USERS

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase

_NO_ID = {"_id": 0}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    coll = db[ADMIN_USERS]
    await coll.create_index("username", unique=True)
    await coll.create_index("user_id", unique=True, sparse=True)
    await coll.create_index("role")
    await coll.create_index("cccd_expires_at", sparse=True)


async def backfill_user_ids(db: AsyncIOMotorDatabase) -> int:
    """Accounts created before Chapter 07 have no user_id / token_version."""
    count = 0
    async for doc in db[ADMIN_USERS].find({"user_id": {"$exists": False}}, {"_id": 1}):
        await db[ADMIN_USERS].update_one(
            {"_id": doc["_id"], "user_id": {"$exists": False}},
            {
                "$set": {
                    "user_id": uuid.uuid4().hex,
                    "token_version": 0,
                    "is_poi_owner_verified": False,
                    "owner_status": "none",
                }
            },
        )
        count += 1
    return count


async def exists_with_role(db: AsyncIOMotorDatabase, role: str) -> bool:
    return await db[ADMIN_USERS].count_documents({"role": role}, limit=1) > 0


async def count_with_role(db: AsyncIOMotorDatabase, role: str) -> int:
    return await db[ADMIN_USERS].count_documents({"role": role})


async def create_user(
    db: AsyncIOMotorDatabase,
    *,
    username: str,
    password_hash: str,
    role: str,
    email: str | None = None,
) -> dict:
    from pymongo.errors import DuplicateKeyError

    now = _now()
    doc = {
        "user_id": uuid.uuid4().hex,
        "username": username.strip().lower(),
        "email": email,
        "password_hash": password_hash,
        "role": role,
        "is_active": True,
        "token_version": 0,
        "is_poi_owner_verified": False,
        "owner_status": "none",
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db[ADMIN_USERS].insert_one(dict(doc))
    except DuplicateKeyError as exc:
        raise ConflictError(f"Username '{doc['username']}' already exists") from exc
    return doc


async def get_by_id(db: AsyncIOMotorDatabase, user_id: str) -> dict | None:
    return await db[ADMIN_USERS].find_one({"user_id": user_id}, _NO_ID)


async def get_by_username(db: AsyncIOMotorDatabase, username: str) -> dict | None:
    return await db[ADMIN_USERS].find_one({"username": username.strip().lower()}, _NO_ID)


async def update_fields(db: AsyncIOMotorDatabase, user_id: str, fields: dict) -> bool:
    result = await db[ADMIN_USERS].update_one(
        {"user_id": user_id}, {"$set": {**fields, "updated_at": fields.get("updated_at", _now())}}
    )
    return result.matched_count > 0


async def record_login(db: AsyncIOMotorDatabase, user_id: str, now: datetime) -> None:
    await db[ADMIN_USERS].update_one({"user_id": user_id}, {"$set": {"last_login_at": now}})


async def bump_token_version(db: AsyncIOMotorDatabase, user_id: str) -> int | None:
    from pymongo import ReturnDocument

    doc = await db[ADMIN_USERS].find_one_and_update(
        {"user_id": user_id},
        {"$inc": {"token_version": 1}, "$set": {"updated_at": _now()}},
        return_document=ReturnDocument.AFTER,
        projection=_NO_ID,
    )
    return None if doc is None else int(doc["token_version"])


async def set_role(db: AsyncIOMotorDatabase, user_id: str, role: str) -> bool:
    return await update_fields(db, user_id, {"role": role})


async def hide_expired_cccd(db: AsyncIOMotorDatabase, now: datetime) -> int:
    """Auto-hide: drop the encrypted CCCD (and its mask) once its retention ended.
    The owner's verification status is not touched."""
    result = await db[ADMIN_USERS].update_many(
        {"cccd_encrypted": {"$type": "string"}, "cccd_expires_at": {"$lte": now}},
        {
            "$set": {
                "cccd_encrypted": None,
                "cccd_masked": None,
                "cccd_hidden_at": now,
                "updated_at": now,
            }
        },
    )
    return result.modified_count
