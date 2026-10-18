"""Retention loop: auto-hide owner CCCD data once its 180 days are over."""

from __future__ import annotations

import asyncio
import logging

from app.services import owner_service

logger = logging.getLogger(__name__)


async def cccd_retention_loop(db, settings) -> None:
    interval = max(int(getattr(settings, "cccd_retention_check_seconds", 3600)), 1)
    while True:
        try:
            await owner_service.hide_expired_cccd(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("CCCD retention iteration failed")
        await asyncio.sleep(interval)
