"""Step 4a — recover audio tasks interrupted by a restart."""

import logging

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.stores import audio_task_store

logger = logging.getLogger(__name__)


async def recover_audio_tasks(db: AsyncIOMotorDatabase) -> int:
    count = await audio_task_store.requeue_all_running(db)
    if count:
        logger.warning("Recovered %d interrupted audio task(s)", count)
    return count
