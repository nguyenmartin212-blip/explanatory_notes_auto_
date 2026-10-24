"""Store layer: only talks to the `ui_bundles` collection.

Holds machine-translated UI bundles of long-tail locales (the 5 top-level
languages are static files). One document per (namespace, locale):
    namespace, locale, source_hash, strings, updated_at
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from app.db.collections import UI_BUNDLES

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[UI_BUNDLES].create_index([("namespace", 1), ("locale", 1)], unique=True)


async def get(db: AsyncIOMotorDatabase, namespace: str, locale: str) -> dict | None:
    return await db[UI_BUNDLES].find_one({"namespace": namespace, "locale": locale}, {"_id": 0})


async def upsert(
    db: AsyncIOMotorDatabase,
    *,
    namespace: str,
    locale: str,
    source_hash: str,
    strings: dict[str, str],
    now: datetime,
) -> None:
    await db[UI_BUNDLES].replace_one(
        {"namespace": namespace, "locale": locale},
        {
            "namespace": namespace,
            "locale": locale,
            "source_hash": source_hash,
            "strings": strings,
            "updated_at": now,
        },
        upsert=True,
    )
