"""Run the persistent queue with one worker per deployment."""
import asyncio
import logging

from starlette.concurrency import run_in_threadpool

from app.services import audio_pipeline_service
from app.stores import audio_task_store as store

logger = logging.getLogger(__name__)


def process(job):
    task_id, poi_id, langs, translate = job
    try:
        ok = audio_pipeline_service.generate_for_poi(
            poi_id, langs, translate,
            on_progress=lambda percent: store.mark(task_id, stage="audio", progress=percent),
        )
        store.mark(task_id, status="completed" if ok else "failed", stage="finished", progress=100,
                   error=None if ok else "One or more localizations failed")
    except Exception:
        logger.exception("Audio task %s failed", task_id)
        store.mark(task_id, status="failed", stage="finished", progress=100, error="Audio generation failed")


async def run_audio_worker(stop: asyncio.Event):
    while not stop.is_set():
        try:
            job = await run_in_threadpool(store.claim)
            if job is not None:
                await run_in_threadpool(process, job)
                continue
        except Exception:
            logger.exception("Audio queue unavailable")
        try:
            await asyncio.wait_for(stop.wait(), timeout=1)
        except TimeoutError:
            pass
