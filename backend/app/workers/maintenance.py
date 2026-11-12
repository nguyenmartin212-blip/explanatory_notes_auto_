"""Maintenance loop: requeue audio tasks stuck in 'processing'."""

import asyncio
import logging

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import Settings
from app.stores import audio_task_store

logger = logging.getLogger(__name__)


async def maintenance_loop(db: AsyncIOMotorDatabase, settings: Settings) -> None:
    while True:
        await asyncio.sleep(settings.maintenance_interval_seconds)
        try:
            count = await audio_task_store.requeue_stale_running(
                db, settings.audio_task_stale_seconds
            )
            if count:
                logger.warning("Requeued %d stale audio task(s)", count)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Maintenance iteration failed")
