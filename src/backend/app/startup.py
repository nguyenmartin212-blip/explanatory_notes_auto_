"""Startup sequence. The order below is the contract from Chapter 01–02:

1. Security & Bootstrap Guard
2. Database / Cache / Media
3. Seeding & Runtime
4. Recovery & Background Workers
5. Mount API (10 routers, /health, /health/ready, /static)

The app only becomes ready (app.state.ready = True) after step 5.
"""

import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.config import Settings
from app.core.security_guard import validate_security_config
from app.db.mongo import check_transaction_support, connect_mongo
from app.db.redis import connect_redis
from app.routers import ROUTERS
from app.routers import health as health_router
from app.services.audio_recovery import recover_audio_tasks
from app.services.audio_task_manager import AudioTaskManager
from app.services.tts_service import TtsService
from app.services.localization_service import LocalizationHydrator
from app.services.media_storage import check_media_storage
from app.services.seeding import run_seeding
from app.workers.maintenance import maintenance_loop
from app.workers.retention import cccd_retention_loop
from app.workers.manager import WorkerManager

logger = logging.getLogger(__name__)


def mount_api(app: FastAPI, settings: Settings) -> None:
    """Step 5."""
    app.include_router(health_router.router)
    for router in ROUTERS:
        app.include_router(router)
    app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
    if settings.media_storage_backend.strip().lower() == "local":
        # Generated audio files (audio_url = <prefix>/audio/<poi_id>/<lang>-<key>.mp3)
        app.mount(
            settings.media_public_prefix, StaticFiles(directory=settings.media_dir), name="media"
        )


async def run_startup(app: FastAPI, settings: Settings) -> None:
    app.state.ready = False
    app.state.workers = WorkerManager()
    app.state.mongo_client = None
    app.state.redis = None

    try:
        # 1. Security & Bootstrap Guard
        validate_security_config(settings)

        # 2. Database / Cache / Media
        client, db = await connect_mongo(settings)
        app.state.mongo_client, app.state.db = client, db
        await check_transaction_support(client, settings)
        app.state.redis = await connect_redis(settings)
        check_media_storage(settings)

        # 3. Seeding & Runtime
        await run_seeding(db, settings)

        # 4. Recovery & Background Workers
        await recover_audio_tasks(db)
        app.state.workers.start("maintenance", lambda: maintenance_loop(db, settings))
        app.state.workers.start("cccd_retention", lambda: cccd_retention_loop(db, settings))
        app.state.tts = TtsService(settings)
        app.state.audio_tasks = AudioTaskManager(db, settings, app.state.tts)
        app.state.workers.start("audio_tasks", app.state.audio_tasks.run)
        app.state.localization = LocalizationHydrator(db, settings, app.state.tts, redis=app.state.redis)
        app.state.workers.start("localization", app.state.localization.run)

        # 5. Mount API
        mount_api(app, settings)
    except BaseException:
        await run_shutdown(app)
        raise

    app.state.ready = True
    logger.info("Backend ready (workers: %s)", app.state.workers.names)


async def run_shutdown(app: FastAPI) -> None:
    app.state.ready = False
    await app.state.workers.stop()
    if app.state.redis is not None:
        await app.state.redis.aclose()
    if app.state.mongo_client is not None:
        app.state.mongo_client.close()
