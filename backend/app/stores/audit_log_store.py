"""Store layer: only talks to the `audit_logs` collection (append-only)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from app.db.collections import AUDIT_LOGS

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[AUDIT_LOGS].create_index([("created_at", -1)])
    await db[AUDIT_LOGS].create_index([("action", 1), ("created_at", -1)])
    await db[AUDIT_LOGS].create_index("target_id", sparse=True)


async def insert(
    db: AsyncIOMotorDatabase,
    *,
    action: str,
    actor_id: str,
    target_id: str | None,
    details: dict | None,
    at: datetime,
) -> None:
    """Never put secrets (CCCD numbers, passwords, tokens) in `details`."""
    await db[AUDIT_LOGS].insert_one(
        {
            "action": action,
            "actor_id": actor_id,
            "target_id": target_id,
            "details": details or {},
            "created_at": at,
        }
    )
