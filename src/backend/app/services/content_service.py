"""POI lifecycle: create -> update -> activate -> (served by sync/nearby) -> delete.

Rules (Chapter 05):
- `POI` holds the source data, `poi_localizations` the per-language content.
- A POI starts as 'draft' and is public ('active') only after activation, which
  requires English content and English audio to be ready.
- When the text an audio was generated from changes, the old audio is dropped
  (file deleted), the language goes back to 'pending' and a new audio task is queued.
- Every change visible to clients bumps `dataset_version`; deleting a public POI
  also leaves a tombstone so delta sync can report it in `removed_poi_ids`.

Router -> service -> store: this module never touches a database driver directly.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from app.core.errors import ConflictError, NotFoundError, NotReadyError
from app.schemas.content import LocalizationIn, PoiCreate, PoiUpdate
from app.services.localization_fallback import (
    compute_content_hash,
    has_valid_audio,
    is_usable,
    narration_text,
)
from app.services.media_storage import delete_media
from app.services.poi_payload import iso, poi_coordinates
from app.stores import (
    audio_task_store,
    poi_dataset_store,
    poi_localization_store,
    poi_store,
)

logger = logging.getLogger(__name__)

REQUIRED_LANGUAGE = "en"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _delete_file(settings, key: str | None) -> None:
    if key:
        await asyncio.to_thread(delete_media, settings, key)


# --------------------------------------------------------------------------- #
# Readiness
# --------------------------------------------------------------------------- #
def evaluate_readiness(english: dict | None) -> dict:
    """A POI may be activated only with usable English content and ready English audio."""
    missing: list[str] = []
    if not is_usable(english):
        missing.append("en_content")
    elif not has_valid_audio(english):
        missing.append("en_audio")
    return {"ready": not missing, "missing": missing}


async def check_readiness(db, poi_id: str) -> dict:
    return evaluate_readiness(await poi_localization_store.get(db, poi_id, REQUIRED_LANGUAGE))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
async def _publish_change(db, poi_id: str) -> int:
    """Make a change of an active POI visible to clients (bump + stamp)."""
    version = await poi_dataset_store.bump_version(db)
    await poi_store.update_fields(db, poi_id, {"dataset_version": version, "updated_at": _now()})
    return version


async def _save_localization(
    db,
    settings,
    poi_id: str,
    language: str,
    data: LocalizationIn,
    existing: dict | None,
    extra: dict | None = None,
) -> bool:
    """Create/replace one language. Returns True if anything changed."""
    now = _now()
    text = narration_text({"tts_script": data.tts_script, "description": data.description})
    new_hash = compute_content_hash(language, text)

    doc = {
        "poi_id": poi_id,
        "language": language,
        "name": data.name,
        "description": data.description,
        "tts_script": data.tts_script,
        "content_hash": new_hash,
        "updated_at": now,
        **(extra or {}),
    }

    same_text = bool(existing) and existing.get("content_hash") == new_hash
    old_audio_path = None
    if same_text:
        # Narration text unchanged: keep the audio (and its state) as it is.
        for key in (
            "audio_status", "audio_url", "audio_path", "audio_hash",
            "audio_sha256", "audio_size", "audio_error",
        ):
            doc[key] = existing.get(key)
        retry = existing.get("audio_status") in (None, "failed") and bool(text)
        if retry:
            doc["audio_status"] = "pending"
            doc["audio_error"] = None
        need_audio = retry
    else:
        old_audio_path = (existing or {}).get("audio_path")
        doc.update(
            audio_status="pending" if text else "none",
            audio_url=None,
            audio_path=None,
            audio_hash=None,
            audio_sha256=None,
            audio_size=None,
            audio_error=None,
        )
        need_audio = bool(text)

    changed = (
        existing is None
        or any(existing.get(k) != doc[k] for k in ("name", "description", "tts_script"))
        or not same_text
    )

    await poi_localization_store.upsert(db, doc)
    await _delete_file(settings, old_audio_path)
    if need_audio:
        await audio_task_store.enqueue(
            db, poi_id=poi_id, language=language, text=text, content_hash=new_hash
        )
    return changed


async def save_localization(
    db, settings, poi_id: str, language: str, data: LocalizationIn, extra: dict | None = None
) -> bool:
    """Create/replace one language of an existing POI (used by automatic translation).

    `extra` holds additional fields stored with the localization. If the POI is
    public the change is published (dataset_version bump). Returns True if changed.
    """
    poi = await poi_store.get(db, poi_id)
    if poi is None:
        raise NotFoundError(f"POI '{poi_id}' not found")
    existing = await poi_localization_store.get(db, poi_id, language)
    changed = await _save_localization(db, settings, poi_id, language, data, existing, extra)
    if changed and poi["status"] == poi_store.STATUS_ACTIVE:
        await _publish_change(db, poi_id)
    return changed


async def ensure_audio(db, poi_id: str, language: str) -> bool:
    """Queue audio for a localization that has usable text but no valid audio and
    no task in flight. Returns True if a task was queued."""
    loc = await poi_localization_store.get(db, poi_id, language)
    if not is_usable(loc) or has_valid_audio(loc):
        return False
    if loc.get("audio_status") == "pending":
        return False  # a task is already queued / running (restart recovery requeues it)
    text = narration_text(loc)
    if not text:
        return False
    content_hash = compute_content_hash(language, text)
    now = _now()
    await poi_localization_store.upsert(
        db, {**loc, "content_hash": content_hash, "audio_status": "pending", "audio_error": None, "updated_at": now}
    )
    await audio_task_store.enqueue(db, poi_id=poi_id, language=language, text=text, content_hash=content_hash)
    return True


async def get_admin_view(db, poi_id: str) -> dict:
    poi = await poi_store.get(db, poi_id)
    if poi is None:
        raise NotFoundError(f"POI '{poi_id}' not found")
    locs = await poi_localization_store.list_for_poi(db, poi_id)
    lat, lng = poi_coordinates(poi)
    return {
        "poi_id": poi_id,
        "status": poi["status"],
        "latitude": lat,
        "longitude": lng,
        "radius_meters": poi["radius_meters"],
        "priority": poi.get("priority", 0),
        "images": poi.get("images", []),
        "map_url": poi.get("map_url"),
        "dataset_version": poi.get("dataset_version"),
        "created_at": iso(poi.get("created_at")),
        "updated_at": iso(poi.get("updated_at")),
        "localizations": {
            language: {
                "name": loc.get("name"),
                "description": loc.get("description"),
                "tts_script": loc.get("tts_script"),
                "audio_status": loc.get("audio_status"),
                "audio_url": loc.get("audio_url") if has_valid_audio(loc) else None,
            }
            for language, loc in sorted(locs.items())
        },
        "readiness": evaluate_readiness(locs.get(REQUIRED_LANGUAGE)),
    }


# --------------------------------------------------------------------------- #
# Lifecycle
# --------------------------------------------------------------------------- #
async def create_poi(db, settings, data: PoiCreate) -> dict:
    poi_id = data.poi_id or f"poi-{uuid.uuid4().hex[:12]}"
    now = _now()
    await poi_store.insert(
        db,
        {
            "poi_id": poi_id,
            "status": poi_store.STATUS_DRAFT,
            "location": {"type": "Point", "coordinates": [data.longitude, data.latitude]},
            "radius_meters": data.radius_meters,
            "priority": data.priority,
            "images": list(data.images),
            "map_url": data.map_url,
            "dataset_version": None,
            "created_at": now,
            "updated_at": now,
        },
    )
    for language, loc in data.localizations.items():
        await _save_localization(db, settings, poi_id, language, loc, None)
    return await get_admin_view(db, poi_id)


async def update_poi(db, settings, poi_id: str, data: PoiUpdate) -> dict:
    poi = await poi_store.get(db, poi_id)
    if poi is None:
        raise NotFoundError(f"POI '{poi_id}' not found")

    sent = data.model_fields_set
    fields: dict = {}
    old_lat, old_lng = poi_coordinates(poi)
    new_lat = data.latitude if data.latitude is not None else old_lat
    new_lng = data.longitude if data.longitude is not None else old_lng
    if (new_lat, new_lng) != (old_lat, old_lng):
        fields["location"] = {"type": "Point", "coordinates": [new_lng, new_lat]}
    for name in ("radius_meters", "priority"):
        value = getattr(data, name)
        if name in sent and value is not None and value != poi.get(name):
            fields[name] = value
    if "images" in sent and data.images is not None and list(data.images) != poi.get("images", []):
        fields["images"] = list(data.images)
    if "map_url" in sent and data.map_url != poi.get("map_url"):
        fields["map_url"] = data.map_url

    changed = bool(fields)
    if data.localizations:
        existing_locs = await poi_localization_store.list_for_poi(db, poi_id)
        for language, loc in data.localizations.items():
            if await _save_localization(db, settings, poi_id, language, loc, existing_locs.get(language)):
                changed = True

    if changed:
        fields["updated_at"] = _now()
        await poi_store.update_fields(db, poi_id, fields)
        if poi["status"] == poi_store.STATUS_ACTIVE:
            await _publish_change(db, poi_id)
    return await get_admin_view(db, poi_id)


async def activate_poi(db, poi_id: str, *, force: bool = False) -> dict:
    """Make a POI public. `force` skips the readiness check (English content + audio);
    it is only for the demo seed script (scripts/seed_pois.py), never for the normal flow."""
    poi = await poi_store.get(db, poi_id)
    if poi is None:
        raise NotFoundError(f"POI '{poi_id}' not found")
    if poi["status"] == poi_store.STATUS_ACTIVE:
        return await get_admin_view(db, poi_id)

    if not force:
        report = await check_readiness(db, poi_id)
        if not report["ready"]:
            raise NotReadyError(report)

    version = await poi_dataset_store.bump_version(db)
    now = _now()
    await poi_store.update_fields(
        db,
        poi_id,
        {
            "status": poi_store.STATUS_ACTIVE,
            "dataset_version": version,
            "activated_at": now,
            "updated_at": now,
        },
    )
    await poi_dataset_store.remove_tombstone(db, poi_id)  # re-activated id is not "removed"
    return await get_admin_view(db, poi_id)


async def delete_poi(db, settings, poi_id: str) -> None:
    poi = await poi_store.get(db, poi_id)
    if poi is None:
        raise NotFoundError(f"POI '{poi_id}' not found")
    was_public = poi["status"] == poi_store.STATUS_ACTIVE

    locs = await poi_localization_store.list_for_poi(db, poi_id)
    audio_paths = [loc["audio_path"] for loc in locs.values() if loc.get("audio_path")]

    # Remove the POI first so it is no longer served, then everything related.
    await poi_store.delete(db, poi_id)
    await poi_localization_store.delete_for_poi(db, poi_id)
    await audio_task_store.delete_for_poi(db, poi_id)

    if was_public:
        version = await poi_dataset_store.bump_version(db)
        await poi_dataset_store.add_tombstone(db, poi_id, version, _now())

    # Media cleanup is best-effort and runs last: a failure must not undo the delete.
    for path in audio_paths:
        await _delete_file(settings, path)


# --------------------------------------------------------------------------- #
# Audio results (called by the audio module / worker)
# --------------------------------------------------------------------------- #
async def complete_audio(
    db,
    settings,
    *,
    poi_id: str,
    language: str,
    content_hash: str,
    audio_path: str,
    audio_url: str,
    audio_sha256: str | None = None,
    audio_size: int | None = None,
) -> bool:
    """Attach a generated audio file. Returns False (and deletes the file) if the
    text changed or the POI was deleted while the audio was being generated."""
    loc = await poi_localization_store.get(db, poi_id, language)
    if loc is None or loc.get("content_hash") != content_hash:
        await _delete_file(settings, audio_path)
        return False

    old_path = loc.get("audio_path")
    ok = await poi_localization_store.mark_audio_ready(
        db,
        poi_id=poi_id,
        language=language,
        content_hash=content_hash,
        audio_path=audio_path,
        audio_url=audio_url,
        audio_sha256=audio_sha256,
        audio_size=audio_size,
        now=_now(),
    )
    if not ok:
        await _delete_file(settings, audio_path)
        return False

    if old_path and old_path != audio_path:
        await _delete_file(settings, old_path)
    poi = await poi_store.get(db, poi_id)
    if poi and poi["status"] == poi_store.STATUS_ACTIVE:
        await _publish_change(db, poi_id)  # clients should pick up the new audio
    return True


async def reset_audio_pending(db, *, poi_id: str, language: str, content_hash: str) -> bool:
    """A failed audio is being retried: show it as pending again."""
    return await poi_localization_store.mark_audio_pending(
        db, poi_id=poi_id, language=language, content_hash=content_hash, now=_now()
    )


async def fail_audio(db, *, poi_id: str, language: str, content_hash: str, error: str) -> bool:
    return await poi_localization_store.mark_audio_failed(
        db, poi_id=poi_id, language=language, content_hash=content_hash, error=error, now=_now()
    )
