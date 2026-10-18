"""Step 3 — Seeding & runtime storage."""

import logging

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth.passwords import default_hasher
from app.auth.permissions import DEFAULT_ROLES, SUPER_ADMIN_ROLE
from app.core.config import Settings
from app.core.errors import StartupError
from app.stores import (
    admin_user_store,
    audio_task_store,
    audit_log_store,
    poi_dataset_store,
    poi_localization_store,
    poi_store,
    role_store,
    ui_bundle_store,
)

logger = logging.getLogger(__name__)


async def seed_roles(db: AsyncIOMotorDatabase) -> int:
    await role_store.ensure_indexes(db)
    await admin_user_store.ensure_indexes(db)
    await audio_task_store.ensure_indexes(db)
    await poi_store.ensure_indexes(db)
    await poi_localization_store.ensure_indexes(db)
    await poi_dataset_store.ensure_indexes(db)
    await audit_log_store.ensure_indexes(db)
    await ui_bundle_store.ensure_indexes(db)
    await admin_user_store.backfill_user_ids(db)
    # Roles live in MongoDB and are edited at runtime: only missing defaults are
    # inserted, existing roles are never overwritten.
    return await role_store.insert_missing_roles(db, DEFAULT_ROLES)


async def seed_super_admin(db: AsyncIOMotorDatabase, settings: Settings) -> bool:
    """Create the first super admin only when bootstrap mode is 'env' and none exists."""
    if settings.superadmin_bootstrap_mode.strip().lower() != "env":
        return False
    if await admin_user_store.exists_with_role(db, SUPER_ADMIN_ROLE):
        return False

    try:
        password_hash = await default_hasher.hash(settings.superadmin_password)
        await admin_user_store.create_user(
            db,
            username=settings.superadmin_username.strip(),
            password_hash=password_hash,
            role=SUPER_ADMIN_ROLE,
        )
    except Exception as exc:
        raise StartupError(f"Cannot create super admin: {exc}") from exc
    logger.info("Super admin '%s' created from environment", settings.superadmin_username)
    return True


def prepare_runtime_storage(settings: Settings) -> None:
    try:
        for path in (
            settings.runtime_dir,
            settings.static_dir,
            settings.media_dir,
            settings.tts_cache_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise StartupError(f"Cannot prepare runtime storage: {exc}") from exc


async def run_seeding(db: AsyncIOMotorDatabase, settings: Settings) -> None:
    await seed_roles(db)
    await seed_super_admin(db, settings)
    prepare_runtime_storage(settings)
