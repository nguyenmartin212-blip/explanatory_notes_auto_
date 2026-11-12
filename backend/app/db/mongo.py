"""Step 2a — MongoDB connection and transaction capability check."""

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import Settings
from app.core.errors import StartupError

logger = logging.getLogger(__name__)


async def connect_mongo(settings: Settings) -> tuple[AsyncIOMotorClient, AsyncIOMotorDatabase]:
    client = AsyncIOMotorClient(
        settings.mongo_uri,
        serverSelectionTimeoutMS=settings.mongo_server_selection_timeout_ms,
        tz_aware=True,
    )
    try:
        await client.admin.command("ping")
    except Exception as exc:
        client.close()
        raise StartupError(f"Cannot connect to MongoDB: {exc}") from exc
    return client, client[settings.mongo_db]


async def check_transaction_support(client: AsyncIOMotorClient, settings: Settings) -> bool:
    """Transactions need a replica set or a sharded cluster (mongos)."""
    hello = await client.admin.command("hello")
    supported = bool(hello.get("setName")) or hello.get("msg") == "isdbgrid"
    if not supported:
        message = "MongoDB does not support transactions (standalone server; use a replica set)"
        if settings.is_development:
            logger.warning(message)
        else:
            raise StartupError(message)
    return supported
