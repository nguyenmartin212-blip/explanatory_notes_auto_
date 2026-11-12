"""Owner CCCD (citizen ID) protection: Fernet encryption, validation, masking.

- The number is stored only as a Fernet token (AES-128-CBC + HMAC-SHA256).
- CCCD_ENCRYPTION_KEYS holds one or more Fernet keys, comma separated. The FIRST
  key encrypts; ALL keys can decrypt, so keys can be rotated without losing data.
- Retention (180 days) and auto-hide live in owner_service.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import re
from collections.abc import Sequence
from functools import lru_cache
from typing import TYPE_CHECKING

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

if TYPE_CHECKING:
    from app.core.config import Settings

logger = logging.getLogger(__name__)

_CCCD_RE = re.compile(r"^(\d{12}|\d{9})$")  # CCCD = 12 digits, old CMND = 9 digits


class CccdFormatError(ValueError):
    """Not a valid CCCD/CMND number."""


class CccdDecryptionError(RuntimeError):
    """The stored value cannot be decrypted with the configured keys."""


def normalize_cccd(raw: str) -> str:
    number = re.sub(r"[\s.\-]", "", raw or "")
    if not _CCCD_RE.match(number):
        raise CccdFormatError("CCCD must be 12 digits (or 9 digits for an old CMND)")
    return number


def mask_cccd(number: str) -> str:
    return "*" * max(len(number) - 4, 0) + number[-4:]


def parse_keys(value: str | Sequence[str] | None) -> list[str]:
    if not value:
        return []
    items = value.split(",") if isinstance(value, str) else value
    return [k.strip() for k in items if k and k.strip()]


def validate_fernet_keys(keys: Sequence[str]) -> list[str]:
    """Return a list of problems (empty if every key is a valid Fernet key)."""
    problems = []
    for index, key in enumerate(keys, start=1):
        try:
            Fernet(key.encode("ascii"))
        except (ValueError, TypeError, UnicodeError):
            problems.append(f"CCCD_ENCRYPTION_KEYS #{index} is not a valid Fernet key (32 url-safe base64 bytes)")
    return problems


def _dev_key(settings: Settings) -> str:
    seed = (getattr(settings, "secret_key", "") or "dev-insecure-cccd-seed").encode()
    return base64.urlsafe_b64encode(hashlib.sha256(b"cccd-dev-key:" + seed).digest()).decode()


def resolve_keys(settings: Settings) -> list[str]:
    keys = parse_keys(getattr(settings, "cccd_encryption_keys", ""))
    if keys:
        return keys
    if getattr(settings, "is_development", False):
        logger.warning("CCCD_ENCRYPTION_KEYS is not set: using a development-only key")
        return [_dev_key(settings)]
    raise RuntimeError("CCCD_ENCRYPTION_KEYS is not configured")


class CccdCipher:
    def __init__(self, keys: Sequence[str]) -> None:
        if not keys:
            raise ValueError("At least one Fernet key is required")
        self._fernet = MultiFernet([Fernet(k.encode("ascii")) for k in keys])

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError, UnicodeError) as exc:
            raise CccdDecryptionError("Cannot decrypt the stored CCCD with the configured keys") from exc


@lru_cache(maxsize=8)
def _cipher_for(keys: tuple[str, ...]) -> CccdCipher:
    return CccdCipher(keys)


def get_cipher(settings: Settings) -> CccdCipher:
    return _cipher_for(tuple(resolve_keys(settings)))
