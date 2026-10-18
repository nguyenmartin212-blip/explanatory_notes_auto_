"""UI bundles (lane 2): namespace `public-ui`.

- The 5 top-level languages (en, vi, zh, ja, ko) are static JSON files in
  app/ui_bundles/<namespace>/<locale>.json; English is the source of truth.
- Any other locale (long tail) is served as the English bundle with
  `status: "pending"` and `source_hash` (hash of the English source) while the
  server translates it in the background; the finished translation is stored in
  MongoDB (`ui_bundles`) and served with `status: "ready"` from then on.
  A translation made from an older English source is not served (hash differs).
- `status: "failed"`: the translation failed; English is served and a new attempt
  is made after UI_BUNDLE_FAILURE_COOLDOWN_SECONDS.

Redis keys (so several processes do not translate the same locale twice):
    ui:lock:<ns>:<locale>   translation queued/running
    ui:fail:<ns>:<locale>   last attempt failed (cooldown)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.errors import RateLimited, TtsError
from app.services import rate_limiter
from app.stores import ui_bundle_store

logger = logging.getLogger(__name__)

NAMESPACE = "public-ui"
SOURCE_LOCALE = "en"
STATIC_LOCALES = ("en", "vi", "zh", "ja", "ko")
BUNDLE_DIR = Path(__file__).resolve().parent.parent / "ui_bundles"
_LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$")
BATCH_SIZE = 25
_PLACEHOLDER_RE = re.compile(r"\{[A-Za-z_]+\}")  # {count}, {poiName}, ... must survive translation


class BatchTranslator(Protocol):
    async def translate_batch(self, texts: list[str], source: str, target: str) -> list[str]: ...


class DeepTranslatorBatch:
    """deep-translator (Google), imported lazily."""

    async def translate_batch(self, texts: list[str], source: str, target: str) -> list[str]:
        def run() -> list[str]:
            from deep_translator import GoogleTranslator

            return GoogleTranslator(source=source, target=target).translate_batch(texts)

        try:
            return await asyncio.to_thread(run)
        except ImportError as exc:
            raise TtsError("deep-translator is not installed") from exc


def normalize_locale(locale: str) -> str:
    """'ja-JP' / 'ja_jp' -> 'ja'. Raises ValueError for something that is not a locale tag."""
    value = (locale or "").strip()
    if not _LOCALE_RE.match(value):
        raise ValueError(f"'{locale}' is not a valid locale")
    return value.replace("_", "-").split("-")[0].lower()


@lru_cache(maxsize=16)
def _load_static(namespace: str, locale: str) -> dict[str, str]:
    path = BUNDLE_DIR / namespace / f"{locale}.json"
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def source_strings(namespace: str = NAMESPACE) -> dict[str, str]:
    return _load_static(namespace, SOURCE_LOCALE)


@lru_cache(maxsize=8)
def _hash_of(namespace: str) -> str:
    canonical = json.dumps(source_strings(namespace), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def source_hash(namespace: str = NAMESPACE) -> str:
    return _hash_of(namespace)


def make_etag(namespace: str, locale: str, status: str, hash_: str) -> str:
    return f'W/"ui-{namespace}-{locale}-{status}-{hash_}"'


def _body(namespace, locale, requested, status, strings, fallback_locale=None) -> dict:
    return {
        "namespace": namespace,
        "locale": locale,
        "requested_locale": requested,
        "status": status,
        "source_hash": source_hash(namespace),
        "fallback_locale": fallback_locale,
        "strings": strings,
    }


def _lock_key(namespace, locale):
    return f"ui:lock:{namespace}:{locale}"


def _fail_key(namespace, locale):
    return f"ui:fail:{namespace}:{locale}"


async def _redis_exists(redis, key: str) -> bool:
    if redis is None:
        return False
    try:
        return bool(await redis.exists(key))
    except Exception as exc:
        logger.warning("Redis unavailable (%s)", exc)
        return False


async def get_bundle(
    db, redis, settings, hydrator, locale: str, *, client: str = "-", namespace: str = NAMESPACE
) -> tuple[dict, int | None]:
    """Return (body, retry_after). `retry_after` is set when the client should poll again later
    after being held back by the limiter."""
    requested = locale
    base = normalize_locale(locale)

    if base in STATIC_LOCALES:
        return _body(namespace, base, requested, "ready", _load_static(namespace, base)), None

    hash_ = source_hash(namespace)
    stored = await ui_bundle_store.get(db, namespace, base)
    if stored and stored.get("source_hash") == hash_:
        return _body(namespace, base, requested, "ready", stored["strings"]), None

    english = _load_static(namespace, SOURCE_LOCALE)
    if await _redis_exists(redis, _lock_key(namespace, base)):
        return _body(namespace, base, requested, "pending", english, SOURCE_LOCALE), None
    if await _redis_exists(redis, _fail_key(namespace, base)):
        return _body(namespace, base, requested, "failed", english, SOURCE_LOCALE), None

    # Nobody is translating this locale yet: start it (limited per client).
    try:
        await rate_limiter.check(
            redis,
            "ui-bundle",
            client,
            limit=settings.localization_rate_limit_requests,
            window_seconds=settings.localization_rate_limit_window_seconds,
        )
    except RateLimited as limited:
        return _body(namespace, base, requested, "pending", english, SOURCE_LOCALE), limited.retry_after

    started = await _start_translation(redis, settings, hydrator, namespace, base)
    status = "pending" if started else "failed"
    return _body(namespace, base, requested, status, english, SOURCE_LOCALE), None


async def _start_translation(redis, settings, hydrator, namespace: str, locale: str) -> bool:
    if redis is not None:
        try:
            if not await redis.set(_lock_key(namespace, locale), "1", ex=settings.ui_bundle_lock_seconds, nx=True):
                return True  # another process just started it
        except Exception as exc:
            logger.warning("Redis unavailable (%s): translating without a cross-process lock", exc)
    if hydrator.enqueue_ui(namespace, locale) == "full":
        await _release(redis, namespace, locale)
        return False
    return True


async def _release(redis, namespace: str, locale: str) -> None:
    if redis is None:
        return
    try:
        await redis.delete(_lock_key(namespace, locale))
    except Exception as exc:
        logger.warning("Cannot release UI bundle lock: %s", exc)


async def translate_bundle(
    db, redis, settings, translator: BatchTranslator, namespace: str, locale: str
) -> None:
    """Background job: translate the English source into `locale` and store it."""
    english = source_strings(namespace)
    keys = list(english)
    try:
        out: list[str] = []
        for start in range(0, len(keys), BATCH_SIZE):
            chunk = [english[k] for k in keys[start : start + BATCH_SIZE]]
            part = await asyncio.wait_for(
                translator.translate_batch(chunk, SOURCE_LOCALE, locale), settings.tts_timeout_seconds
            )
            if len(part) != len(chunk) or any(not (t or "").strip() for t in part):
                raise TtsError("Translation returned incomplete results")
            out.extend(part)
        strings = {}
        for key, translated in zip(keys, out):
            # A translation that lost or changed a {placeholder} is unusable: keep the English text.
            same = set(_PLACEHOLDER_RE.findall(english[key])) == set(_PLACEHOLDER_RE.findall(translated))
            strings[key] = translated if same else english[key]
        await ui_bundle_store.upsert(
            db,
            namespace=namespace,
            locale=locale,
            source_hash=source_hash(namespace),
            strings=strings,
            now=datetime.now(timezone.utc),
        )
        logger.info("UI bundle %s/%s translated", namespace, locale)
    except asyncio.CancelledError:
        await _release(redis, namespace, locale)
        raise
    except Exception as exc:
        logger.warning("UI bundle %s/%s translation failed: %s", namespace, locale, exc)
        if redis is not None:
            try:
                await redis.set(_fail_key(namespace, locale), "1", ex=settings.ui_bundle_failure_cooldown_seconds)
            except Exception:
                pass
    finally:
        await _release(redis, namespace, locale)
