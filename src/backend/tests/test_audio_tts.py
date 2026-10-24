"""TTSService tests: translate, MD5 cache, Edge-TTS (faked), storing files."""

import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.core.errors import TtsError
from app.services.tts_service import EDGE_VOICES, TtsService


class FakeTranslator:
    def __init__(self):
        self.calls = []
        self.result = None

    async def translate(self, text, source, target):
        self.calls.append((text, source, target))
        return f"[{target}] {text}" if self.result is None else self.result


class FakeSynth:
    def __init__(self):
        self.calls = []
        self.active = 0
        self.max_active = 0
        self.gate: asyncio.Event | None = None
        self.fail: Exception | None = None
        self.empty = False
        self.delay = 0.0

    async def synthesize(self, text, voice, out_path: Path):
        self.calls.append((text, voice))
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.gate is not None:
                await self.gate.wait()
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.fail:
                raise self.fail
            out_path.write_bytes(b"" if self.empty else b"MP3:" + text.encode("utf-8"))
        finally:
            self.active -= 1


def make_settings(root: Path, **extra):
    return SimpleNamespace(
        tts_cache_dir=root / "cache",
        tts_timeout_seconds=extra.pop("tts_timeout_seconds", 5),
        media_dir=root / "media",
        media_storage_backend="local",
        media_public_prefix="/media",
        audio_max_concurrency=3,
        audio_poll_interval_seconds=0.01,
        **extra,
    )


class TtsBase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.translator, self.synth = FakeTranslator(), FakeSynth()
        self.settings = make_settings(self.root)
        self.tts = TtsService(self.settings, self.translator, self.synth)


class CacheKeyTests(TtsBase):
    def test_cache_key_is_md5_of_text_colon_lang(self):
        self.assertEqual(TtsService.cache_key("hello", "en"), hashlib.md5(b"hello:en").hexdigest())
        self.assertNotEqual(TtsService.cache_key("hello", "en"), TtsService.cache_key("hello", "vi"))
        self.assertEqual(TtsService.cache_key("xin chào", "vi"), hashlib.md5("xin chào:vi".encode()).hexdigest())


class TranslateTests(TtsBase):
    async def test_same_language_or_no_source_is_a_noop(self):
        self.assertEqual(await self.tts.translate("  hello ", "en", "en"), "hello")
        self.assertEqual(await self.tts.translate("hello", None, "en"), "hello")
        self.assertEqual(self.translator.calls, [])

    async def test_translates_with_the_backend(self):
        self.assertEqual(await self.tts.translate("xin chào", "vi", "en"), "[en] xin chào")
        self.assertEqual(self.translator.calls, [("xin chào", "vi", "en")])

    async def test_bad_input_and_empty_translation(self):
        with self.assertRaises(ValueError):
            await self.tts.translate("   ", "vi", "en")
        with self.assertRaises(ValueError):
            await self.tts.translate("hi", "vi", "fr")
        with self.assertRaises(ValueError):
            await self.tts.translate("hi", "fr", "en")
        self.translator.result = "  "
        with self.assertRaises(TtsError):
            await self.tts.translate("hi", "vi", "en")


class SynthesisTests(TtsBase):
    async def test_synthesizes_once_then_serves_from_cache(self):
        first = await self.tts.ensure_audio("Hello world", "en")
        second = await self.tts.ensure_audio("Hello world", "en")
        self.assertFalse(first.cache_hit)
        self.assertTrue(second.cache_hit)
        self.assertEqual(len(self.synth.calls), 1)
        self.assertEqual(self.synth.calls[0], ("Hello world", EDGE_VOICES["en"]))
        self.assertEqual(first.cache_path, self.root / "cache" / f"{TtsService.cache_key('Hello world', 'en')}.mp3")
        self.assertEqual(first.cache_path.read_bytes(), b"MP3:Hello world")

    async def test_voice_follows_the_language(self):
        await self.tts.ensure_audio("Xin chào", "vi")
        self.assertEqual(self.synth.calls[0][1], EDGE_VOICES["vi"])
        with self.assertRaises(ValueError):
            await self.tts.ensure_audio("Bonjour", "fr")

    async def test_same_text_other_language_is_a_different_cache_entry(self):
        await self.tts.ensure_audio("Hotel", "en")
        await self.tts.ensure_audio("Hotel", "vi")
        self.assertEqual(len(self.synth.calls), 2)

    async def test_concurrent_requests_share_one_synthesis(self):
        self.synth.gate = asyncio.Event()
        jobs = [asyncio.create_task(self.tts.ensure_audio("Same text", "en")) for _ in range(5)]
        await asyncio.sleep(0.05)
        self.synth.gate.set()
        results = await asyncio.gather(*jobs)
        self.assertEqual(len(self.synth.calls), 1)
        self.assertEqual(len({r.cache_key for r in results}), 1)

    async def test_failure_leaves_no_files_and_is_retried_later(self):
        self.synth.fail = RuntimeError("network down")
        with self.assertRaisesRegex(TtsError, "network down"):
            await self.tts.ensure_audio("Hello", "en")
        self.assertEqual(list((self.root / "cache").iterdir()), [])
        self.synth.fail = None
        result = await self.tts.ensure_audio("Hello", "en")
        self.assertFalse(result.cache_hit)
        self.assertEqual([p.suffix for p in (self.root / "cache").iterdir()], [".mp3"])

    async def test_empty_output_is_an_error(self):
        self.synth.empty = True
        with self.assertRaisesRegex(TtsError, "empty"):
            await self.tts.ensure_audio("Hello", "en")
        self.assertEqual(list((self.root / "cache").iterdir()), [])

    async def test_zero_byte_cache_file_counts_as_a_miss(self):
        (self.root / "cache").mkdir()
        (self.root / "cache" / f"{TtsService.cache_key('Hello', 'en')}.mp3").write_bytes(b"")
        result = await self.tts.ensure_audio("Hello", "en")
        self.assertFalse(result.cache_hit)
        self.assertEqual(len(self.synth.calls), 1)

    async def test_timeout_is_reported(self):
        tts = TtsService(make_settings(self.root, tts_timeout_seconds=0.05), self.translator, self.synth)
        self.synth.delay = 1
        with self.assertRaisesRegex(TtsError, "timed out"):
            await tts.ensure_audio("Slow", "en")
        self.assertEqual(list((self.root / "cache").iterdir()), [])

    async def test_generate_translates_then_uses_the_translated_text_as_cache_key(self):
        result = await self.tts.generate("xin chào", "en", source_lang="vi")
        self.assertEqual(result.spoken_text, "[en] xin chào")
        self.assertEqual(result.cache_key, TtsService.cache_key("[en] xin chào", "en"))
        self.assertEqual(self.synth.calls[0][0], "[en] xin chào")
        again = await self.tts.generate("xin chào", "en", source_lang="vi")
        self.assertTrue(again.cache_hit)
        self.assertEqual(len(self.synth.calls), 1)


class StoreAudioTests(TtsBase):
    async def test_copies_the_cached_file_and_reports_sha256_and_size(self):
        result = await self.tts.ensure_audio("Hello", "en")
        dest = self.root / "media" / "audio" / "poi-a" / "en-x.mp3"
        sha256, size = await self.tts.store_audio(result.cache_key, dest)
        data = b"MP3:Hello"
        self.assertEqual((sha256, size), (hashlib.sha256(data).hexdigest(), len(data)))
        self.assertEqual(dest.read_bytes(), data)
        self.assertTrue(result.cache_path.exists())  # the cache keeps its own file
        self.assertEqual([p.name for p in dest.parent.iterdir()], ["en-x.mp3"])


if __name__ == "__main__":
    unittest.main()
