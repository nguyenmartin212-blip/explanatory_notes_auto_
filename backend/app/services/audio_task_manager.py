"""AudioTaskManager: runs audio-generation tasks in the background.

- At most `audio_max_concurrency` (3) tasks run at the same time.
- Task state lives in the `audio_tasks` collection, so it survives a restart
  (startup recovery requeues tasks that were 'running').
- Statuses: queued, running, paused, completed, failed, cancelled.
- Admin actions: pause, resume, cancel, retry. A running task is interrupted
  cooperatively at the next stage boundary (it is never killed mid-write).

Pipeline per task:
    source text -> translate -> cache lookup -> Edge-TTS -> save MP3 -> update localization

The manager polls the database for queued tasks (every `audio_poll_interval_seconds`,
or immediately after an admin action / a finished task), and claims them atomically,
so it also works with more than one worker process. Pause/cancel of a *running*
task only works from the process that runs it.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from app.core.errors import ConflictError, NotFoundError, TtsError
from app.services import content_service
from app.services.poi_payload import iso
from app.services.tts_service import TtsService
from app.stores import audio_task_store, poi_localization_store

logger = logging.getLogger(__name__)

STAGE_PROGRESS = {
    "translating": 10,
    "checking_cache": 30,
    "synthesizing": 40,
    "saving": 85,
    "updating_localization": 95,
}


class _Interrupted(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind  # "pause" | "cancel"


def task_view(doc: dict) -> dict:
    """Public JSON shape of a task (admin API and SSE)."""
    return {
        "task_id": doc.get("task_id"),
        "poi_id": doc.get("poi_id"),
        "language": doc.get("language"),
        "source_lang": doc.get("source_lang"),
        "status": doc.get("status"),
        "stage": doc.get("stage"),
        "progress": doc.get("progress", 0),
        "error": doc.get("error"),
        "attempts": doc.get("attempts", 0),
        "cache_hit": doc.get("cache_hit"),
        "result": doc.get("result"),
        "audio_url": doc.get("audio_url"),
        "created_at": iso(doc.get("created_at")),
        "queued_at": iso(doc.get("queued_at")),
        "started_at": iso(doc.get("started_at")),
        "finished_at": iso(doc.get("finished_at")),
        "updated_at": iso(doc.get("updated_at")),
    }


class AudioTaskManager:
    def __init__(self, db, settings, tts: TtsService) -> None:
        self.db = db
        self.settings = settings
        self.tts = tts
        self.max_concurrency = int(getattr(settings, "audio_max_concurrency", 3))
        self.poll_interval = float(getattr(settings, "audio_poll_interval_seconds", 2.0))
        self._sem = asyncio.Semaphore(self.max_concurrency)
        self._wake = asyncio.Event()
        self._running: dict[str, asyncio.Task] = {}
        self._interrupts: dict[str, str] = {}

    # ------------------------------------------------------------------ #
    # Dispatcher
    # ------------------------------------------------------------------ #
    @property
    def running_count(self) -> int:
        return len(self._running)

    def wake(self) -> None:
        self._wake.set()

    async def run(self) -> None:
        """Dispatcher loop; run it as a background worker."""
        try:
            while True:
                await self._sem.acquire()
                try:
                    task = await audio_task_store.claim_next(self.db)
                except Exception:
                    self._sem.release()
                    logger.exception("Cannot claim an audio task")
                    await self._sleep_or_wake()
                    continue
                if task is None:
                    self._sem.release()
                    await self._sleep_or_wake()
                    continue
                self._running[task["task_id"]] = asyncio.create_task(
                    self._run_task(task), name=f"audio-task:{task['task_id']}"
                )
        finally:
            running = list(self._running.values())
            for job in running:
                job.cancel()
            await asyncio.gather(*running, return_exceptions=True)

    async def _sleep_or_wake(self) -> None:
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=self.poll_interval)
        except TimeoutError:
            pass
        self._wake.clear()

    # ------------------------------------------------------------------ #
    # One task
    # ------------------------------------------------------------------ #
    async def _run_task(self, task: dict) -> None:
        task_id = task["task_id"]
        try:
            fields: dict
            try:
                fields = await self._pipeline(task)
                status = audio_task_store.COMPLETED
                fields.update(progress=100, stage="completed")
            except _Interrupted as stop:
                status = (
                    audio_task_store.PAUSED if stop.kind == "pause" else audio_task_store.CANCELLED
                )
                fields = {"stage": status}
            except Exception as exc:
                logger.exception("Audio task %s failed", task_id)
                message = str(exc)[:500] or exc.__class__.__name__
                status = audio_task_store.FAILED
                fields = {"error": message, "stage": "failed"}
                try:
                    await content_service.fail_audio(
                        self.db,
                        poi_id=task["poi_id"],
                        language=task["language"],
                        content_hash=task["content_hash"],
                        error=message,
                    )
                except Exception:
                    logger.exception("Cannot record audio failure for task %s", task_id)

            self._interrupts.pop(task_id, None)
            await audio_task_store.finalize(self.db, task_id, status=status, fields=fields)
        finally:
            self._running.pop(task_id, None)
            self._sem.release()
            self._wake.set()

    async def _stage(self, task: dict, name: str, extra: dict | None = None) -> None:
        await audio_task_store.set_progress(
            self.db, task["task_id"], stage=name, progress=STAGE_PROGRESS[name], extra=extra
        )
        kind = self._interrupts.get(task["task_id"])
        if kind:
            raise _Interrupted(kind)

    async def _pipeline(self, task: dict) -> dict:
        poi_id, language = task["poi_id"], task["language"]
        if self.settings.media_storage_backend.strip().lower() != "local":
            raise TtsError("Media storage is disabled (MEDIA_STORAGE_BACKEND=none): cannot save audio")

        if await poi_localization_store.get(self.db, poi_id, language) is None:
            return {"result": "discarded", "error": "localization no longer exists"}

        source = task.get("source_lang") or language
        await self._stage(task, "translating")
        spoken = await self.tts.translate(task["text"], source, language)

        key = self.tts.cache_key(spoken, language)
        await self._stage(task, "checking_cache")
        cache_hit = self.tts.cache_has(key)
        if not cache_hit:
            await self._stage(task, "synthesizing")
        result = await self.tts.ensure_audio(spoken, language)

        await self._stage(task, "saving", {"cache_hit": result.cache_hit})
        rel_path = f"audio/{poi_id}/{language}-{result.cache_key}.mp3"
        sha256, size = await self.tts.store_audio(result.cache_key, self.settings.media_dir / rel_path)
        audio_url = f"{self.settings.media_public_prefix.rstrip('/')}/{rel_path}"

        await self._stage(task, "updating_localization")
        accepted = await content_service.complete_audio(
            self.db,
            self.settings,
            poi_id=poi_id,
            language=language,
            content_hash=task["content_hash"],
            audio_path=rel_path,
            audio_url=audio_url,
            audio_sha256=sha256,
            audio_size=size,
        )
        if accepted:
            return {"cache_hit": result.cache_hit, "result": "ok", "audio_url": audio_url, "error": None}
        # The text changed (or the POI was deleted) while the audio was generated.
        return {"cache_hit": result.cache_hit, "result": "stale", "audio_url": None}

    # ------------------------------------------------------------------ #
    # Admin actions
    # ------------------------------------------------------------------ #
    async def _get(self, task_id: str) -> dict:
        doc = await audio_task_store.get(self.db, task_id)
        if doc is None:
            raise NotFoundError(f"Audio task '{task_id}' not found")
        return doc

    def _interrupt_running(self, doc: dict, kind: str) -> dict:
        task_id = doc["task_id"]
        if task_id not in self._running:
            raise ConflictError("Task is running in another process or is orphaned; cannot interrupt it here")
        self._interrupts[task_id] = kind
        return {**task_view(doc), "interrupt_requested": kind}

    async def pause(self, task_id: str) -> dict:
        doc = await self._get(task_id)
        if doc["status"] == audio_task_store.QUEUED:
            moved = await audio_task_store.transition(
                self.db, task_id, from_statuses=[audio_task_store.QUEUED], to_status=audio_task_store.PAUSED
            )
            if moved:
                return task_view(moved)
            doc = await self._get(task_id)  # it was claimed in the meantime
        if doc["status"] == audio_task_store.RUNNING:
            return self._interrupt_running(doc, "pause")
        raise ConflictError(f"Cannot pause a {doc['status']} task")

    async def cancel(self, task_id: str) -> dict:
        doc = await self._get(task_id)
        if doc["status"] in (audio_task_store.QUEUED, audio_task_store.PAUSED):
            moved = await audio_task_store.transition(
                self.db,
                task_id,
                from_statuses=[audio_task_store.QUEUED, audio_task_store.PAUSED],
                to_status=audio_task_store.CANCELLED,
                fields={"stage": "cancelled"},
            )
            if moved:
                return task_view(moved)
            doc = await self._get(task_id)
        if doc["status"] == audio_task_store.RUNNING:
            return self._interrupt_running(doc, "cancel")
        raise ConflictError(f"Cannot cancel a {doc['status']} task")

    async def resume(self, task_id: str) -> dict:
        doc = await self._get(task_id)
        moved = await audio_task_store.transition(
            self.db,
            task_id,
            from_statuses=[audio_task_store.PAUSED],
            to_status=audio_task_store.QUEUED,
            fields={"stage": None, "progress": 0},
        )
        if moved is None:
            raise ConflictError(f"Cannot resume a {doc['status']} task")
        self.wake()
        return task_view(moved)

    async def retry(self, task_id: str) -> dict:
        doc = await self._get(task_id)
        moved = await audio_task_store.transition(
            self.db,
            task_id,
            from_statuses=[audio_task_store.FAILED, audio_task_store.CANCELLED],
            to_status=audio_task_store.QUEUED,
            fields={"stage": None, "progress": 0, "error": None, "result": None, "finished_at": None},
        )
        if moved is None:
            raise ConflictError(f"Cannot retry a {doc['status']} task")
        await content_service.reset_audio_pending(
            self.db, poi_id=moved["poi_id"], language=moved["language"], content_hash=moved["content_hash"]
        )
        self.wake()
        return task_view(moved)

    async def list_tasks(self, limit: int = 100) -> list[dict]:
        return [task_view(doc) for doc in await audio_task_store.list_recent(self.db, limit)]
