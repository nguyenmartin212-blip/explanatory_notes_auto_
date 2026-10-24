"""Media storage helpers: startup check (Chapter 02) and cleanup (Chapter 05)."""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from app.core.errors import StartupError

if TYPE_CHECKING:
    from app.core.config import Settings

logger = logging.getLogger(__name__)


def check_media_storage(settings: Settings) -> bool:
    """Return True if checked, False if skipped (backend 'none')."""
    backend = settings.media_storage_backend.strip().lower()
    if backend == "none":
        return False
    if backend != "local":
        raise StartupError(f"Unsupported MEDIA_STORAGE_BACKEND '{backend}' (use 'local' or 'none')")

    try:
        settings.media_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.media_dir / f".write-check-{uuid.uuid4().hex}"
        probe.write_bytes(b"ok")
        probe.unlink()
    except OSError as exc:
        raise StartupError(f"Media storage '{settings.media_dir}' is not writable: {exc}") from exc
    return True


def delete_media(settings: Settings, key: str | None) -> bool:
    """Best-effort delete of one stored file by its storage key.

    Returns True if a file was removed. Never raises: cleanup must not break
    the data operation that triggered it. Keys escaping the media dir are refused.
    """
    if not key or settings.media_storage_backend.strip().lower() != "local":
        return False
    try:
        base = settings.media_dir.resolve()
        target = (base / key.lstrip("/\\")).resolve()
        if base not in target.parents:
            logger.warning("Refusing to delete media outside media dir: %r", key)
            return False
        target.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError as exc:
        logger.warning("Media cleanup failed for %r: %s", key, exc)
        return False
