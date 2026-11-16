"""Requeue interrupted audio tasks at startup (adapted from Extra)."""
import logging

from starlette.concurrency import run_in_threadpool

from app.stores.audio_task_store import AudioTaskStore

logger = logging.getLogger(__name__)


async def recover_audio_tasks() -> int:
    count = await run_in_threadpool(AudioTaskStore.requeue_all_running)
    if count:
        logger.warning("Recovered %d interrupted audio tasks", count)
    return count
