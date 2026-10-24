"""Content locale lane (Chapter 08).

Hydration = make sure a POI has usable content (and audio) in the target language,
translating it from the best available source: target -> English -> Vietnamese.
Human-written content is never overwritten; a machine translation is redone only
when the source text it came from has changed.

    prepare_hotset  up to 10 nearest POIs within 1.5 km; the 3 nearest are `required`
                    and the switch is `ready` only when all of them have content AND audio
    on_demand       reactive: hydrate one POI now
    warmup          background: hydrate the whole public corpus

Work runs through LocalizationHydrator, an in-process priority queue with a bounded
number of translations at once. Queue full / no free slot -> RateLimited(Retry-After).
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
import time

from app.core.errors import NotFoundError, RateLimited, TtsError
from app.schemas.content import SUPPORTED_LANGUAGES, LocalizationIn
from app.services import content_service, rate_limiter, ui_bundle_service
from app.services.localization_fallback import (
    fallback_chain,
    has_valid_audio,
    is_usable,
    resolve_content,
)
from app.services.poi_nearby import find_candidates
from app.stores import poi_localization_store, poi_store

logger = logging.getLogger(__name__)

PRIORITY_REQUIRED, PRIORITY_HOTSET, PRIORITY_WARMUP = 0, 1, 2


# --------------------------------------------------------------------------- #
# Pure rules
# --------------------------------------------------------------------------- #
def pick_source(locs: dict[str, dict], target: str) -> tuple[str, dict] | None:
    """Best source to translate from: English, else Vietnamese (never the target itself)."""
    for language in fallback_chain(target):
        if language != target and is_usable(locs.get(language)):
            return language, locs[language]
    return None


def needs_translation(target_loc: dict | None, source: dict | None) -> bool:
    if source is None:
        return False
    if not is_usable(target_loc):
        return True
    # A machine translation whose source text has changed is outdated.
    return bool(
        target_loc.get("machine_translated")
        and target_loc.get("source_content_hash") != source.get("content_hash")
    )


def poi_state(locs: dict[str, dict], lang: str, failure: str | None = None) -> dict:
    target = locs.get(lang)
    picked = pick_source(locs, lang)
    source = picked[1] if picked else None
    content_ready = is_usable(target) and not needs_translation(target, source)
    audio_ready = content_ready and has_valid_audio(target)
    if audio_ready:
        state = "ready"
    elif not content_ready and source is None:
        state = "no_source"  # nothing to translate from: it will be served with fallback
    elif failure:
        state = "failed"
    else:
        state = "pending"
    out = {"content_ready": content_ready, "audio_ready": audio_ready, "state": state}
    if failure and state == "failed":
        out["error"] = failure
    return out


def _clip(value: str | None, limit: int) -> str | None:
    return value[:limit] if value else value


# --------------------------------------------------------------------------- #
# Hydrator (queue + workers)
# --------------------------------------------------------------------------- #
class LocalizationHydrator:
    def __init__(self, db, settings, tts, redis=None, ui_translator=None) -> None:
        self.db = db
        self.settings = settings
        self.tts = tts
        self.redis = redis
        self.ui_translator = ui_translator or ui_bundle_service.DeepTranslatorBatch()
        self.concurrency = max(int(settings.localization_translate_concurrency), 1)
        self.queue_max = int(settings.localization_queue_max)
        self.failure_cooldown = int(settings.localization_failure_cooldown_seconds)
        self._heap: list[tuple[int, int, tuple]] = []
        self._seq = itertools.count()
        self._queued: set[tuple] = set()
        self._wake = asyncio.Event()
        self._sem = asyncio.Semaphore(self.concurrency)
        self._failures: dict[tuple[str, str], tuple[float, str]] = {}
        self._active: set[tuple] = set()

    # ---- queue ---------------------------------------------------------- #
    @property
    def pending_count(self) -> int:
        return len(self._queued)

    def _enqueue(self, key: tuple, priority: int) -> str:
        if key in self._queued or key in self._active:
            return "duplicate"
        if len(self._queued) >= self.queue_max:
            return "full"
        self._queued.add(key)
        heapq.heappush(self._heap, (priority, next(self._seq), key))
        self._wake.set()
        return "queued"

    def enqueue_poi(self, poi_id: str, lang: str, priority: int = PRIORITY_HOTSET) -> str:
        """'queued' | 'duplicate' | 'full' | 'cooldown' (it failed a moment ago)."""
        if self.failure(poi_id, lang):
            return "cooldown"
        return self._enqueue(("poi", poi_id, lang), priority)

    def enqueue_ui(self, namespace: str, locale: str) -> str:
        return self._enqueue(("ui", namespace, locale), PRIORITY_HOTSET)

    def failure(self, poi_id: str, lang: str) -> str | None:
        item = self._failures.get((poi_id, lang))
        if item is None:
            return None
        if item[0] <= time.monotonic():
            del self._failures[(poi_id, lang)]
            return None
        return item[1]

    def retry_after_hint(self) -> int:
        """Rough wait until a full queue has room again."""
        return max(int(self.pending_count / self.concurrency) + 1, 5)

    async def run(self) -> None:
        """Worker loop; run it as a background worker."""
        workers = [asyncio.create_task(self._consume()) for _ in range(self.concurrency)]
        try:
            await asyncio.gather(*workers)
        finally:
            for task in workers:
                task.cancel()
            await asyncio.gather(*workers, return_exceptions=True)

    async def _consume(self) -> None:
        while True:
            if not self._heap:
                self._wake.clear()
                await self._wake.wait()
                continue
            _, _, key = heapq.heappop(self._heap)
            self._queued.discard(key)
            self._active.add(key)
            try:
                if key[0] == "poi":
                    await self._hydrate_guarded(key[1], key[2])
                else:
                    await ui_bundle_service.translate_bundle(
                        self.db, self.redis, self.settings, self.ui_translator, key[1], key[2]
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Localization job %s failed", key)
            finally:
                self._active.discard(key)

    # ---- hydration ------------------------------------------------------ #
    async def _hydrate_guarded(self, poi_id: str, lang: str) -> str | None:
        async with self._sem:
            try:
                return await hydrate_poi(self.db, self.settings, self.tts, poi_id, lang)
            except NotFoundError:
                return None  # deleted meanwhile
            except Exception as exc:
                message = str(exc)[:300] or exc.__class__.__name__
                logger.warning("Hydration of %s/%s failed: %s", poi_id, lang, message)
                self._failures[(poi_id, lang)] = (time.monotonic() + self.failure_cooldown, message)
                return None

    async def hydrate_now(self, poi_id: str, lang: str) -> str:
        """Reactive hydration (on-demand). Waits for a free slot at most
        LOCALIZATION_ON_DEMAND_WAIT_SECONDS, then asks the client to retry later."""
        wait = float(self.settings.localization_on_demand_wait_seconds)
        try:
            await asyncio.wait_for(self._sem.acquire(), wait)
        except TimeoutError:
            raise RateLimited(self.retry_after_hint(), "Translation capacity is busy") from None
        try:
            return await hydrate_poi(self.db, self.settings, self.tts, poi_id, lang)
        finally:
            self._sem.release()


async def hydrate_poi(db, settings, tts, poi_id: str, lang: str) -> str:
    """Returns 'translated' | 'present' | 'no_source'. Raises NotFoundError / TtsError."""
    check_language(lang)
    poi = await poi_store.get(db, poi_id)
    if poi is None or poi.get("status") != poi_store.STATUS_ACTIVE:
        raise NotFoundError(f"POI '{poi_id}' not found")
    locs = await poi_localization_store.list_for_poi(db, poi_id)
    picked = pick_source(locs, lang)
    if picked is None:
        if is_usable(locs.get(lang)):
            await content_service.ensure_audio(db, poi_id, lang)
            return "present"
        return "no_source"
    source_lang, source = picked

    if not needs_translation(locs.get(lang), source):
        await content_service.ensure_audio(db, poi_id, lang)  # text is fine; make sure audio exists
        return "present"

    async def tr(text: str | None) -> str | None:
        return await tts.translate(text, source_lang, lang) if text and text.strip() else None

    name, description, script = await asyncio.gather(
        tr(source.get("name")), tr(source.get("description")), tr(source.get("tts_script"))
    )
    data = LocalizationIn(
        name=_clip(name, 200) or "",
        description=_clip(description, 5000) or "",
        tts_script=_clip(script, 5000),
    )
    await content_service.save_localization(
        db,
        settings,
        poi_id,
        lang,
        data,
        extra={
            "machine_translated": True,
            "translated_from": source_lang,
            "source_content_hash": source.get("content_hash"),
        },
    )
    return "translated"


def check_language(lang: str) -> None:
    if lang not in SUPPORTED_LANGUAGES:
        raise ValueError(f"Unsupported language '{lang}'; supported: {list(SUPPORTED_LANGUAGES)}")


# --------------------------------------------------------------------------- #
# Endpoints' logic
# --------------------------------------------------------------------------- #
async def _limit_client(redis, settings, scope: str, client: str) -> None:
    await rate_limiter.check(
        redis,
        scope,
        client,
        limit=settings.localization_rate_limit_requests,
        window_seconds=settings.localization_rate_limit_window_seconds,
    )


async def prepare_hotset(
    db, redis, settings, hydrator: LocalizationHydrator, *, lat: float, lng: float, lang: str, client: str
) -> dict:
    """Warm the nearest POIs for `lang`. Safe to call repeatedly: it reports progress."""
    check_language(lang)
    await _limit_client(redis, settings, "hotset", client)

    radius = int(settings.localization_hotset_radius_m)
    source, found = await find_candidates(
        db, lat=lat, lng=lng, radius_m=radius, limit=int(settings.localization_hotset_max_pois)
    )
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p, _ in found])
    required_n = int(settings.localization_hotset_required)

    items, queued, full = [], 0, False
    for index, (poi, distance) in enumerate(found):
        poi_id = poi["poi_id"]
        required = index < required_n
        state = poi_state(locs.get(poi_id, {}), lang, hydrator.failure(poi_id, lang))
        if state["state"] == "pending":
            priority = PRIORITY_REQUIRED if required else PRIORITY_HOTSET
            outcome = hydrator.enqueue_poi(poi_id, lang, priority)
            queued += outcome == "queued"
            full = full or outcome == "full"
        items.append({"poi_id": poi_id, "distance_m": round(distance, 1), "required": required, **state})
    if full and not queued:
        raise RateLimited(hydrator.retry_after_hint(), "Translation queue is full")

    # no_source cannot become ready, so it does not hold the switch back
    ready = all(i["state"] in ("ready", "no_source") for i in items if i["required"])
    return {
        "language": lang,
        "radius_m": radius,
        "max_pois": int(settings.localization_hotset_max_pois),
        "source": source,
        "required_poi_ids": [i["poi_id"] for i in items if i["required"]],
        "ready": ready,
        "count": len(items),
        "pois": items,
    }


async def on_demand(
    db, redis, settings, hydrator: LocalizationHydrator, *, poi_id: str, lang: str, client: str
) -> dict:
    """Reactive: hydrate one POI now. Audio is generated in the background."""
    check_language(lang)
    await _limit_client(redis, settings, "on-demand", client)
    result = await hydrator.hydrate_now(poi_id, lang)
    locs = await poi_localization_store.list_for_poi(db, poi_id)
    return {
        "poi_id": poi_id,
        "language": lang,
        "result": result,
        **poi_state(locs, lang),
        "content": resolve_content(locs, lang),
    }


async def warmup(
    db, redis, settings, hydrator: LocalizationHydrator, *, lang: str | None, client: str
) -> dict:
    """Queue the whole public corpus (background). One run per language per cooldown."""
    languages = [lang] if lang else list(SUPPORTED_LANGUAGES)
    for language in languages:
        check_language(language)
    await _limit_client(redis, settings, "warmup", client)
    await rate_limiter.cooldown(
        redis, f"warmup:{lang or 'all'}", seconds=int(settings.localization_warmup_cooldown_seconds)
    )

    pois = await poi_store.list_active(db)
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p in pois])
    result: dict[str, dict] = {}
    queued_total = skipped_full = 0
    for language in languages:
        queued = already_ok = 0
        for poi in sorted(pois, key=lambda p: (-p.get("priority", 0), p["poi_id"])):
            poi_id = poi["poi_id"]
            if poi_state(locs.get(poi_id, {}), language)["state"] != "pending":
                already_ok += 1
                continue
            outcome = hydrator.enqueue_poi(poi_id, language, PRIORITY_WARMUP)
            if outcome == "queued":
                queued += 1
            elif outcome == "full":
                skipped_full += 1
        result[language] = {"queued": queued, "already_ok": already_ok}
        queued_total += queued
    if skipped_full and not queued_total:
        raise RateLimited(hydrator.retry_after_hint(), "Translation queue is full")
    return {
        "status": "accepted",
        "total_pois": len(pois),
        "queued": queued_total,
        "skipped_queue_full": skipped_full,
        "languages": result,
    }
