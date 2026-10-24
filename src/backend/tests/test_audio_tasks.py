"""AudioTaskManager, pack-manifest and SSE tests (in-memory stores, faked TTS backends)."""

import asyncio
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.core.errors import ConflictError, NotFoundError
from app.schemas.content import PoiCreate, PoiUpdate
from app.services import audio_pack, audio_sse
from app.services import content_service as svc
from app.services.audio_task_manager import AudioTaskManager, task_view
from app.services.tts_service import TtsService
from tests.fakes import install
from tests.test_audio_tts import FakeSynth, FakeTranslator, make_settings

HANOI = (21.0353, 105.8402)


def create_data(poi_id, en="Citadel text", vi=None):
    locs = {"en": {"name": poi_id, "description": en}}
    if vi:
        locs["vi"] = {"name": poi_id, "description": vi}
    return PoiCreate(poi_id=poi_id, latitude=HANOI[0], longitude=HANOI[1], localizations=locs)


class ManagerBase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.w, ctx = install(self)
        self.db = ctx.db
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.settings = make_settings(self.root)
        self.translator, self.synth = FakeTranslator(), FakeSynth()
        self.tts = TtsService(self.settings, self.translator, self.synth)
        self.manager = AudioTaskManager(self.db, self.settings, self.tts)
        self._runner = None

    async def asyncTearDown(self):
        await self.stop()

    # -- helpers --------------------------------------------------------- #
    def start(self):
        self._runner = asyncio.create_task(self.manager.run())

    async def stop(self):
        if self._runner:
            self._runner.cancel()
            await asyncio.gather(self._runner, return_exceptions=True)
            self._runner = None

    async def create(self, poi_id, **kw):
        return await svc.create_poi(self.db, self.settings, create_data(poi_id, **kw))

    def task(self, poi_id, language="en"):
        return self.w.tasks[(poi_id, language)]

    def loc(self, poi_id, language="en"):
        return self.w.locs[(poi_id, language)]

    async def until(self, condition, timeout=3.0):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while not condition():
            if loop.time() > deadline:
                self.fail(f"condition not reached; tasks={[(k, v['status'], v['stage']) for k, v in self.w.tasks.items()]}")
            await asyncio.sleep(0.005)

    async def until_status(self, poi_id, status, language="en"):
        await self.until(lambda: self.task(poi_id, language)["status"] == status)


class PipelineTests(ManagerBase):
    async def test_end_to_end_generates_stores_and_updates_the_localization(self):
        await self.create("poi-a", en="The Citadel")
        self.assertEqual(self.task("poi-a")["status"], "queued")
        self.start()
        await self.until_status("poi-a", "completed")

        key = TtsService.cache_key("The Citadel", "en")
        rel = f"audio/poi-a/en-{key}.mp3"
        data = b"MP3:The Citadel"
        task, loc = self.task("poi-a"), self.loc("poi-a")
        self.assertEqual((task["progress"], task["stage"], task["result"], task["cache_hit"]), (100, "completed", "ok", False))
        self.assertEqual(task["audio_url"], f"/media/{rel}")
        self.assertEqual(loc["audio_status"], "ready")
        self.assertEqual((loc["audio_path"], loc["audio_url"]), (rel, f"/media/{rel}"))
        self.assertEqual((loc["audio_sha256"], loc["audio_size"]), (hashlib.sha256(data).hexdigest(), len(data)))
        self.assertEqual(loc["audio_hash"], loc["content_hash"])
        self.assertEqual((self.root / "media" / rel).read_bytes(), data)
        self.assertEqual(self.synth.calls, [("The Citadel", "en-US-AriaNeural")])
        # The POI can now be activated: English audio is ready.
        self.assertTrue((await svc.check_readiness(self.db, "poi-a"))["ready"])

    async def test_tts_script_is_what_gets_spoken(self):
        await svc.create_poi(
            self.db, self.settings,
            PoiCreate(poi_id="poi-a", latitude=1, longitude=1,
                      localizations={"en": {"name": "A", "description": "Long text", "tts_script": "Short script"}}),
        )
        self.start()
        await self.until_status("poi-a", "completed")
        self.assertEqual(self.synth.calls[0][0], "Short script")

    async def test_identical_text_reuses_the_cache_but_each_poi_gets_its_own_file(self):
        await self.create("poi-a", en="Same words")
        await self.create("poi-b", en="Same words")
        self.start()
        await self.until_status("poi-a", "completed")
        await self.until_status("poi-b", "completed")
        self.assertEqual(len(self.synth.calls), 1)  # the two runs shared one synthesis
        # A later POI with the same text is a plain cache hit.
        await self.create("poi-c", en="Same words")
        await self.until_status("poi-c", "completed")
        self.assertEqual(len(self.synth.calls), 1)
        self.assertTrue(self.task("poi-c")["cache_hit"])
        path_a, path_b = self.loc("poi-a")["audio_path"], self.loc("poi-b")["audio_path"]
        self.assertNotEqual(path_a, path_b)
        self.assertTrue((self.root / "media" / path_a).exists() and (self.root / "media" / path_b).exists())

    async def test_source_language_is_translated_before_synthesis(self):
        await self.create("poi-a", en="Old english", vi="Xin chào")
        en_hash = self.loc("poi-a")["content_hash"]
        # Re-queue English audio from the Vietnamese source text.
        await self.w_task_store().enqueue(self.db, poi_id="poi-a", language="en", text="Xin chào",
                                          content_hash=en_hash, source_lang="vi")
        self.start()
        await self.until_status("poi-a", "completed")
        self.assertEqual(self.translator.calls, [("Xin chào", "vi", "en")])
        self.assertIn(("[en] Xin chào", "en-US-AriaNeural"), self.synth.calls)
        self.assertEqual(self.loc("poi-a")["audio_status"], "ready")

    def w_task_store(self):
        from app.services import audio_task_manager
        return audio_task_manager.audio_task_store

    async def test_discards_a_task_whose_localization_disappeared(self):
        await self.create("poi-a")
        self.w.locs.clear()
        self.start()
        await self.until_status("poi-a", "completed")
        self.assertEqual(self.task("poi-a")["result"], "discarded")
        self.assertEqual(self.synth.calls, [])

    async def test_fails_with_a_clear_error_when_media_storage_is_disabled(self):
        self.settings.media_storage_backend = "none"
        await self.create("poi-a")
        self.start()
        await self.until_status("poi-a", "failed")
        self.assertIn("Media storage is disabled", self.task("poi-a")["error"])


class ConcurrencyTests(ManagerBase):
    async def test_at_most_three_tasks_run_at_the_same_time(self):
        self.synth.gate = asyncio.Event()
        for i in range(6):
            await self.create(f"poi-{i}", en=f"Distinct text {i}")
        self.start()
        await self.until(lambda: self.synth.active == 3)
        await asyncio.sleep(0.1)  # give a 4th task every chance to start
        statuses = sorted(t["status"] for t in self.w.tasks.values())
        self.assertEqual(statuses, ["queued"] * 3 + ["running"] * 3)
        self.assertEqual((self.manager.running_count, self.synth.max_active), (3, 3))

        self.synth.gate.set()
        await self.until(lambda: all(t["status"] == "completed" for t in self.w.tasks.values()))
        self.assertEqual(self.synth.max_active, 3)
        self.assertEqual(len(self.synth.calls), 6)

    async def test_queued_tasks_run_oldest_first(self):
        order = []
        original = self.synth.synthesize

        async def recording(text, voice, out):
            order.append(text)
            await original(text, voice, out)

        self.synth.synthesize = recording
        manager = AudioTaskManager(self.db, make_settings(self.root, ), TtsService(self.settings, self.translator, self.synth))
        manager.max_concurrency = 1
        manager._sem = asyncio.Semaphore(1)
        for i in range(4):
            await self.create(f"poi-{i}", en=f"Text {i}")
        runner = asyncio.create_task(manager.run())
        self.addCleanup(lambda: runner.cancel())
        await self.until(lambda: all(t["status"] == "completed" for t in self.w.tasks.values()))
        self.assertEqual(order, [f"Text {i}" for i in range(4)])


class ControlTests(ManagerBase):
    async def test_pause_a_queued_task_then_resume(self):
        await self.create("poi-a")
        task_id = self.task("poi-a")["task_id"]
        view = await self.manager.pause(task_id)
        self.assertEqual(view["status"], "paused")
        self.start()
        await asyncio.sleep(0.1)
        self.assertEqual(self.task("poi-a")["status"], "paused")  # never claimed
        self.assertEqual(self.synth.calls, [])

        self.assertEqual((await self.manager.resume(task_id))["status"], "queued")
        await self.until_status("poi-a", "completed")

    async def test_cancel_a_queued_task_then_retry(self):
        await self.create("poi-a")
        task_id = self.task("poi-a")["task_id"]
        self.assertEqual((await self.manager.cancel(task_id))["status"], "cancelled")
        self.assertIsNotNone(self.task("poi-a")["finished_at"])
        self.start()
        await asyncio.sleep(0.05)
        self.assertEqual(self.synth.calls, [])
        self.assertEqual((await self.manager.retry(task_id))["status"], "queued")
        await self.until_status("poi-a", "completed")
        self.assertEqual(self.loc("poi-a")["audio_status"], "ready")

    async def test_cancel_a_running_task_stops_it_before_saving(self):
        self.synth.gate = asyncio.Event()
        await self.create("poi-a")
        task_id = self.task("poi-a")["task_id"]
        self.start()
        await self.until(lambda: self.synth.active == 1)
        view = await self.manager.cancel(task_id)
        self.assertEqual((view["status"], view["interrupt_requested"]), ("running", "cancel"))
        self.synth.gate.set()
        await self.until_status("poi-a", "cancelled")
        self.assertEqual(self.loc("poi-a")["audio_status"], "pending")
        self.assertFalse((self.root / "media").exists())  # nothing was saved
        self.assertEqual(self.manager.running_count, 0)

    async def test_pause_a_running_task_then_resume_finishes_from_the_cache(self):
        self.synth.gate = asyncio.Event()
        await self.create("poi-a")
        task_id = self.task("poi-a")["task_id"]
        self.start()
        await self.until(lambda: self.synth.active == 1)
        await self.manager.pause(task_id)
        self.synth.gate.set()
        await self.until_status("poi-a", "paused")

        await self.manager.resume(task_id)
        await self.until_status("poi-a", "completed")
        self.assertEqual(len(self.synth.calls), 1)  # not synthesized twice
        self.assertTrue(self.task("poi-a")["cache_hit"])

    async def test_invalid_actions_are_rejected(self):
        await self.create("poi-a")
        task_id = self.task("poi-a")["task_id"]
        with self.assertRaises(NotFoundError):
            await self.manager.pause("nope")
        with self.assertRaises(ConflictError):
            await self.manager.resume(task_id)  # queued, not paused
        with self.assertRaises(ConflictError):
            await self.manager.retry(task_id)  # queued, not failed/cancelled
        self.start()
        await self.until_status("poi-a", "completed")
        for action in (self.manager.pause, self.manager.cancel, self.manager.resume, self.manager.retry):
            with self.assertRaises(ConflictError):
                await action(task_id)


class FailureAndChangeTests(ManagerBase):
    async def test_failure_marks_task_and_localization_then_retry_succeeds(self):
        self.synth.fail = RuntimeError("edge-tts unreachable")
        await self.create("poi-a")
        task_id = self.task("poi-a")["task_id"]
        self.start()
        await self.until_status("poi-a", "failed")
        self.assertIn("edge-tts unreachable", self.task("poi-a")["error"])
        self.assertEqual(self.loc("poi-a")["audio_status"], "failed")
        self.assertEqual(self.manager.running_count, 0)

        self.synth.fail = None
        await self.manager.retry(task_id)
        self.assertEqual(self.loc("poi-a")["audio_status"], "pending")
        await self.until_status("poi-a", "completed")
        self.assertEqual(self.loc("poi-a")["audio_status"], "ready")
        self.assertEqual(self.task("poi-a")["attempts"], 2)

    async def test_text_changed_while_running_discards_the_old_audio_and_runs_again(self):
        self.synth.gate = asyncio.Event()
        await self.create("poi-a", en="Old text")
        self.start()
        await self.until(lambda: self.synth.active == 1)

        await svc.update_poi(self.db, self.settings, "poi-a",
                             PoiUpdate(localizations={"en": {"name": "poi-a", "description": "New text"}}))
        self.assertTrue(self.task("poi-a")["rerun"])
        self.synth.gate.set()
        await self.until(lambda: self.task("poi-a")["status"] == "completed" and self.loc("poi-a")["audio_status"] == "ready")

        self.assertEqual([c[0] for c in self.synth.calls], ["Old text", "New text"])
        loc = self.loc("poi-a")
        self.assertEqual(loc["audio_hash"], loc["content_hash"])
        self.assertEqual(loc["audio_path"], f"audio/poi-a/en-{TtsService.cache_key('New text', 'en')}.mp3")
        old_rel = f"audio/poi-a/en-{TtsService.cache_key('Old text', 'en')}.mp3"
        self.assertIn(old_rel, self.w.deleted_files)  # the stale copy was thrown away
        self.assertEqual(self.task("poi-a")["result"], "ok")


class RecoveryShapeTests(ManagerBase):
    async def test_task_view_is_json_serializable(self):
        await self.create("poi-a")
        view = task_view(self.task("poi-a"))
        json.dumps(view)
        self.assertEqual((view["status"], view["language"], view["progress"]), ("queued", "en", 0))


class PackManifestTests(ManagerBase):
    async def make_public(self, poi_id, text, sha_seed):
        await self.create(poi_id, en=text)
        loc = self.loc(poi_id)
        await svc.complete_audio(
            self.db, self.settings, poi_id=poi_id, language="en", content_hash=loc["content_hash"],
            audio_path=f"audio/{poi_id}/en.mp3", audio_url=f"/media/audio/{poi_id}/en.mp3",
            audio_sha256=hashlib.sha256(sha_seed.encode()).hexdigest(), audio_size=100,
        )
        await svc.activate_poi(self.db, poi_id)

    async def test_lists_files_with_size_sha256_and_a_content_addressed_version(self):
        empty = await audio_pack.build_manifest(self.db)
        self.assertEqual((empty["count"], empty["files"]), (0, []))

        await self.make_public("poi-a", "Text A", "a")
        await self.make_public("poi-b", "Text B", "b")
        manifest = await audio_pack.build_manifest(self.db)
        self.assertEqual([f["poi_id"] for f in manifest["files"]], ["poi-a", "poi-b"])
        self.assertEqual(manifest["files"][0], {
            "poi_id": "poi-a", "language": "en", "url": "/media/audio/poi-a/en.mp3",
            "path": "audio/poi-a/en.mp3", "size": 100, "sha256": hashlib.sha256(b"a").hexdigest(),
        })
        self.assertEqual((manifest["count"], manifest["total_bytes"]), (2, 200))
        self.assertEqual(manifest["dataset_version"], self.w.version)

        again = await audio_pack.build_manifest(self.db)
        self.assertEqual(again["pack_version"], manifest["pack_version"])  # stable

        # New audio for poi-a => different file hash => new pack version.
        await svc.update_poi(self.db, self.settings, "poi-a",
                             PoiUpdate(localizations={"en": {"name": "poi-a", "description": "Changed"}}))
        h = self.loc("poi-a")["content_hash"]
        await svc.complete_audio(self.db, self.settings, poi_id="poi-a", language="en", content_hash=h,
                                 audio_path="audio/poi-a/en2.mp3", audio_url="/media/audio/poi-a/en2.mp3",
                                 audio_sha256=hashlib.sha256(b"a2").hexdigest(), audio_size=120)
        changed = await audio_pack.build_manifest(self.db)
        self.assertNotEqual(changed["pack_version"], manifest["pack_version"])
        self.assertEqual(changed["total_bytes"], 220)

    async def test_only_public_ready_audio_is_listed(self):
        await self.make_public("poi-a", "Text A", "a")
        await self.create("poi-draft", en="Draft text")  # draft + audio pending
        h = self.loc("poi-draft")["content_hash"]
        await svc.complete_audio(self.db, self.settings, poi_id="poi-draft", language="en", content_hash=h,
                                 audio_path="audio/poi-draft/en.mp3", audio_url="u",
                                 audio_sha256="x" * 64, audio_size=1)
        # public POI whose text changed: its audio is stale and must not be offered
        await self.make_public("poi-stale", "Old", "s")
        await svc.update_poi(self.db, self.settings, "poi-stale",
                             PoiUpdate(localizations={"en": {"name": "poi-stale", "description": "New"}}))
        manifest = await audio_pack.build_manifest(self.db)
        self.assertEqual([f["poi_id"] for f in manifest["files"]], ["poi-a"])

    async def test_language_filter(self):
        await self.create("poi-a", en="English", vi="Tiếng Việt")
        for language in ("en", "vi"):
            h = self.w.locs[("poi-a", language)]["content_hash"]
            await svc.complete_audio(self.db, self.settings, poi_id="poi-a", language=language, content_hash=h,
                                     audio_path=f"audio/poi-a/{language}.mp3", audio_url=f"/m/{language}",
                                     audio_sha256=language * 32, audio_size=1)
        await svc.activate_poi(self.db, "poi-a")
        self.assertEqual(len((await audio_pack.build_manifest(self.db))["files"]), 2)
        only_vi = await audio_pack.build_manifest(self.db, lang="vi")
        self.assertEqual([f["language"] for f in only_vi["files"]], ["vi"])

    def test_etag(self):
        self.assertEqual(audio_pack.make_pack_etag("abc"), 'W/"pack-abc"')


class SseTests(ManagerBase):
    async def collect(self, ticks, hooks=None, **kw):
        """Run the stream for `ticks` polling rounds, applying hooks[i] before round i."""
        hooks = hooks or {}
        state = {"round": 0, "now": 0.0}

        async def is_disconnected():
            return state["round"] >= ticks

        async def fake_sleep(_seconds):
            hook = hooks.get(state["round"])
            state["round"] += 1
            if hook:
                await hook()

        def clock():
            state["now"] += 10.0
            return state["now"]

        chunks = []
        async for chunk in audio_sse.event_stream(
            self.db, is_disconnected=is_disconnected, sleep=fake_sleep, clock=clock, **kw
        ):
            chunks.append(chunk)
        return chunks

    def parse(self, chunk):
        lines = chunk.strip().split("\n")
        return lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))

    def test_format(self):
        self.assertEqual(audio_sse.format_sse("task", {"a": "é"}), 'event: task\ndata: {"a": "é"}\n\n')

    async def test_snapshot_then_changes_then_keepalive(self):
        await self.create("poi-a")
        await self.create("poi-b", en="Other text")
        task_id = self.task("poi-a")["task_id"]

        async def pause_a():
            await self.manager.pause(task_id)

        async def cancel_a():
            await self.manager.cancel(task_id)

        chunks = await self.collect(5, hooks={0: pause_a, 1: cancel_a}, keepalive_seconds=15)
        event, snapshot = self.parse(chunks[0])
        self.assertEqual(event, "snapshot")
        self.assertEqual({t["poi_id"] for t in snapshot["tasks"]}, {"poi-a", "poi-b"})

        changes = [self.parse(c) for c in chunks[1:] if c.startswith("event: task")]
        self.assertEqual([(e, t["poi_id"], t["status"]) for e, t in changes],
                         [("task", "poi-a", "paused"), ("task", "poi-a", "cancelled")])
        self.assertTrue(any(c == ": keepalive\n\n" for c in chunks))

    async def test_nothing_is_repeated_when_nothing_changes(self):
        await self.create("poi-a")
        chunks = await self.collect(4, keepalive_seconds=10_000)
        self.assertEqual(len(chunks), 1)  # only the snapshot

    async def test_progress_updates_are_streamed(self):
        await self.create("poi-a")
        self.synth.gate = asyncio.Event()

        async def start_manager():
            self.start()
            await self.until(lambda: self.synth.active == 1)

        async def finish():
            self.synth.gate.set()
            await self.until_status("poi-a", "completed")

        chunks = await self.collect(3, hooks={0: start_manager, 1: finish}, keepalive_seconds=10_000)
        seen = [self.parse(c)[1] for c in chunks if c.startswith("event: task")]
        self.assertEqual(seen[-1]["status"], "completed")
        self.assertEqual(seen[-1]["progress"], 100)
        self.assertIn("synthesizing", {t["stage"] for t in seen})


if __name__ == "__main__":
    unittest.main()
