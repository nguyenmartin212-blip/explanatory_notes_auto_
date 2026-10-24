"""In-memory stand-ins for the store modules, so services can be tested without MongoDB."""

import copy
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from app.core.errors import ConflictError, GeoQueryUnavailable
from app.services import audio_pack, audio_sse, audio_task_manager, content_service, poi_nearby, poi_sync
from app.utils.geo import haversine_m


class World:
    def __init__(self):
        self.pois: dict[str, dict] = {}
        self.locs: dict[tuple[str, str], dict] = {}
        self.tombstones: dict[str, dict] = {}
        self.tasks: dict[tuple[str, str], dict] = {}
        self.version = 0
        self.deleted_files: list[str] = []
        self.enqueued: list[tuple[str, str, str]] = []
        self.geo_fail = False


class FakePoiStore:
    STATUS_DRAFT = "draft"
    STATUS_ACTIVE = "active"

    def __init__(self, w):
        self.w = w

    async def insert(self, db, doc):
        if doc["poi_id"] in self.w.pois:
            raise ConflictError("exists")
        self.w.pois[doc["poi_id"]] = copy.deepcopy(doc)

    async def get(self, db, poi_id):
        return copy.deepcopy(self.w.pois.get(poi_id))

    async def update_fields(self, db, poi_id, fields):
        if poi_id not in self.w.pois:
            return False
        self.w.pois[poi_id].update(copy.deepcopy(fields))
        return True

    async def delete(self, db, poi_id):
        return self.w.pois.pop(poi_id, None) is not None

    def _active(self):
        return [copy.deepcopy(p) for p in self.w.pois.values() if p["status"] == "active"]

    async def list_active(self, db):
        return self._active()

    async def list_active_since_version(self, db, version):
        return [p for p in self._active() if p["dataset_version"] > version]

    async def list_active_updated_after(self, db, after):
        return [p for p in self._active() if p["updated_at"] > after]

    async def geo_near(self, db, *, lat, lng, max_distance_m, limit):
        if self.w.geo_fail:
            raise GeoQueryUnavailable("no 2dsphere index")
        found = []
        for p in self._active():
            p_lng, p_lat = p["location"]["coordinates"]
            d = haversine_m(lat, lng, p_lat, p_lng)
            if d <= max_distance_m:
                found.append((p, d))
        found.sort(key=lambda item: item[1])
        return found[:limit]


class FakeLocStore:
    def __init__(self, w):
        self.w = w

    async def get(self, db, poi_id, language):
        return copy.deepcopy(self.w.locs.get((poi_id, language)))

    async def list_for_poi(self, db, poi_id):
        return {l: copy.deepcopy(d) for (p, l), d in self.w.locs.items() if p == poi_id}

    async def list_for_pois(self, db, poi_ids):
        result: dict = {}
        for (p, l), d in self.w.locs.items():
            if p in poi_ids:
                result.setdefault(p, {})[l] = copy.deepcopy(d)
        return result

    async def upsert(self, db, doc):
        self.w.locs[(doc["poi_id"], doc["language"])] = copy.deepcopy(doc)

    async def mark_audio_ready(
        self, db, *, poi_id, language, content_hash, audio_path, audio_url, now,
        audio_sha256=None, audio_size=None,
    ):
        loc = self.w.locs.get((poi_id, language))
        if not loc or loc["content_hash"] != content_hash:
            return False
        loc.update(
            audio_status="ready", audio_url=audio_url, audio_path=audio_path, audio_hash=content_hash,
            audio_sha256=audio_sha256, audio_size=audio_size, audio_error=None,
        )
        return True

    async def mark_audio_pending(self, db, *, poi_id, language, content_hash, now):
        loc = self.w.locs.get((poi_id, language))
        if not loc or loc["content_hash"] != content_hash or loc.get("audio_status") != "failed":
            return False
        loc.update(audio_status="pending", audio_error=None)
        return True

    async def mark_audio_failed(self, db, *, poi_id, language, content_hash, error, now):
        loc = self.w.locs.get((poi_id, language))
        if not loc or loc["content_hash"] != content_hash:
            return False
        loc.update(audio_status="failed", audio_error=error)
        return True

    async def delete_for_poi(self, db, poi_id):
        keys = [k for k in self.w.locs if k[0] == poi_id]
        for k in keys:
            del self.w.locs[k]
        return len(keys)


class FakeDatasetStore:
    def __init__(self, w):
        self.w = w

    async def get_version(self, db):
        return self.w.version

    async def bump_version(self, db):
        self.w.version += 1
        return self.w.version

    async def add_tombstone(self, db, poi_id, version, deleted_at):
        self.w.tombstones[poi_id] = {"dataset_version": version, "deleted_at": deleted_at}

    async def remove_tombstone(self, db, poi_id):
        self.w.tombstones.pop(poi_id, None)

    async def tombstone_ids_since_version(self, db, version):
        return [i for i, t in self.w.tombstones.items() if t["dataset_version"] > version]

    async def tombstone_ids_deleted_after(self, db, after):
        return [i for i, t in self.w.tombstones.items() if t["deleted_at"] > after]


class FakeTaskStore:
    """Mirrors app.stores.audio_task_store (same statuses and semantics)."""

    QUEUED, RUNNING, PAUSED = "queued", "running", "paused"
    COMPLETED, FAILED, CANCELLED = "completed", "failed", "cancelled"
    TERMINAL_STATUSES = ("completed", "failed", "cancelled")

    def __init__(self, w):
        self.w = w
        self._seq = 0
        self._clock = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def _now(self):
        self._clock += timedelta(milliseconds=1)
        return self._clock

    def _find(self, task_id):
        for doc in self.w.tasks.values():
            if doc["task_id"] == task_id:
                return doc
        return None

    async def enqueue(self, db, *, poi_id, language, text, content_hash, source_lang=None):
        self.w.enqueued.append((poi_id, language, content_hash))
        now = self._now()
        base = {"text": text, "content_hash": content_hash, "source_lang": source_lang or language, "updated_at": now}
        doc = self.w.tasks.get((poi_id, language))
        if doc and doc["status"] == self.RUNNING:
            doc.update(base, rerun=True)
            return "rerun"
        if doc and doc["status"] == self.PAUSED:
            doc.update(base)
            return "paused"
        self._seq += 1
        fresh = dict(
            base, status=self.QUEUED, queued_at=now, rerun=False, stage=None, progress=0, error=None,
            cache_hit=None, result=None,
        )
        if doc is None:
            fresh.update(task_id=f"t{self._seq}", poi_id=poi_id, language=language, created_at=now, attempts=0)
            self.w.tasks[(poi_id, language)] = fresh
        else:
            doc.update(fresh)
        self.w.tasks[(poi_id, language)]["seq"] = self._seq
        return "queued"

    async def get(self, db, task_id):
        doc = self._find(task_id)
        return copy.deepcopy(doc) if doc else None

    async def claim_next(self, db):
        queued = [d for d in self.w.tasks.values() if d["status"] == self.QUEUED]
        if not queued:
            return None
        doc = min(queued, key=lambda d: (d["queued_at"], d["seq"]))
        now = self._now()
        doc.update(status=self.RUNNING, started_at=now, updated_at=now, stage="starting", progress=0, error=None)
        doc["attempts"] += 1
        return copy.deepcopy(doc)

    async def set_progress(self, db, task_id, *, stage, progress, extra=None):
        doc = self._find(task_id)
        if not doc or doc["status"] != self.RUNNING:
            return False
        doc.update(stage=stage, progress=progress, updated_at=self._now(), **(extra or {}))
        return True

    async def finalize(self, db, task_id, *, status, fields=None):
        doc = self._find(task_id)
        if doc is None:
            return None
        now = self._now()
        update = dict(fields or {})
        if doc.get("rerun") and status in (self.COMPLETED, self.FAILED):
            update.update(status=self.QUEUED, queued_at=now, progress=0, stage=None, error=None)
        else:
            update["status"] = status
            if status in self.TERMINAL_STATUSES:
                update["finished_at"] = now
        update.update(rerun=False, updated_at=now)
        doc.update(update)
        return copy.deepcopy(doc)

    async def transition(self, db, task_id, *, from_statuses, to_status, fields=None):
        doc = self._find(task_id)
        if doc is None or doc["status"] not in list(from_statuses):
            return None
        now = self._now()
        doc.update(status=to_status, updated_at=now, **(fields or {}))
        if to_status == self.QUEUED:
            doc["queued_at"] = now
        if to_status in self.TERMINAL_STATUSES:
            doc["finished_at"] = now
        return copy.deepcopy(doc)

    async def list_recent(self, db, limit=100):
        docs = sorted(self.w.tasks.values(), key=lambda d: d["updated_at"], reverse=True)
        return [copy.deepcopy(d) for d in docs[:limit]]

    async def list_updated_since(self, db, since):
        docs = sorted((d for d in self.w.tasks.values() if d["updated_at"] >= since), key=lambda d: d["updated_at"])
        return [copy.deepcopy(d) for d in docs]

    async def delete_for_poi(self, db, poi_id):
        keys = [k for k in self.w.tasks if k[0] == poi_id]
        for k in keys:
            del self.w.tasks[k]
        return len(keys)


def install(test_case) -> tuple[World, SimpleNamespace]:
    """Patch the store modules used by the services with in-memory fakes."""
    w = World()
    poi, loc = FakePoiStore(w), FakeLocStore(w)
    dataset, task = FakeDatasetStore(w), FakeTaskStore(w)

    def delete_media(settings, key):  # called through asyncio.to_thread
        w.deleted_files.append(key)
        return True

    stack = ExitStack()
    test_case.addCleanup(stack.close)
    for module in (content_service, poi_sync, poi_nearby, audio_task_manager, audio_pack, audio_sse):
        for name, fake in (
            ("poi_store", poi),
            ("poi_localization_store", loc),
            ("poi_dataset_store", dataset),
            ("audio_task_store", task),
        ):
            if hasattr(module, name):
                stack.enter_context(mock.patch.object(module, name, fake))
    stack.enter_context(mock.patch.object(content_service, "delete_media", delete_media))
    return w, SimpleNamespace(db=object(), settings=SimpleNamespace())
