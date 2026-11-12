"""TTSService: translate with deep-translator, speak with Edge-TTS, cache MP3 files.

Flow (Chapter 06):  source text -> translate -> cache lookup -> Edge-TTS -> MP3 file.

Cache key: MD5(f"{text}:{lang}") where `text` is the text that is actually
spoken (after translation). MD5 is only a cache key here, not a security measure.
The cache directory is separate from the public media directory; per-POI audio
files are copies (see `store_audio`), so deleting one POI's audio can never break
another POI that happens to share the same spoken text.

`deep_translator` and `edge_tts` are imported lazily, and both backends are
replaceable, so the rest of the system and the tests do not need them installed.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from app.core.errors import TtsError

if TYPE_CHECKING:
    from app.core.config import Settings

EDGE_VOICES = {
    "vi": "vi-VN-HoaiMyNeural",
    "en": "en-US-AriaNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
    "ja": "ja-JP-NanamiNeural",
    "ko": "ko-KR-SunHiNeural",
}
TRANSLATE_CODES = {"vi": "vi", "en": "en", "zh": "zh-CN", "ja": "ja", "ko": "ko"}


class Translator(Protocol):
    async def translate(self, text: str, source: str, target: str) -> str: ...


class Synthesizer(Protocol):
    async def synthesize(self, text: str, voice: str, out_path: Path) -> None: ...


class DeepTranslatorBackend:
    async def translate(self, text: str, source: str, target: str) -> str:
        def run() -> str:
            from deep_translator import GoogleTranslator

            return GoogleTranslator(
                source=TRANSLATE_CODES[source], target=TRANSLATE_CODES[target]
            ).translate(text)

        try:
            return await asyncio.to_thread(run)
        except ImportError as exc:
            raise TtsError("deep-translator is not installed") from exc


class EdgeTtsBackend:
    async def synthesize(self, text: str, voice: str, out_path: Path) -> None:
        try:
            import edge_tts
        except ImportError as exc:
            raise TtsError("edge-tts is not installed") from exc
        await edge_tts.Communicate(text, voice).save(str(out_path))


@dataclass(frozen=True)
class TtsResult:
    spoken_text: str
    cache_key: str
    cache_path: Path
    cache_hit: bool


class TtsService:
    def __init__(
        self,
        settings: Settings,
        translator: Translator | None = None,
        synthesizer: Synthesizer | None = None,
    ) -> None:
        self.cache_dir = Path(settings.tts_cache_dir)
        self.timeout = getattr(settings, "tts_timeout_seconds", 60)
        self._translator = translator or DeepTranslatorBackend()
        self._synthesizer = synthesizer or EdgeTtsBackend()
        self._inflight: dict[str, asyncio.Future] = {}

    # ---- cache ---------------------------------------------------------- #
    @staticmethod
    def check_language(lang: str) -> None:
        if lang not in EDGE_VOICES:
            raise ValueError(f"Unsupported language '{lang}'; supported: {sorted(EDGE_VOICES)}")

    @staticmethod
    def cache_key(text: str, lang: str) -> str:
        return hashlib.md5(f"{text}:{lang}".encode("utf-8"), usedforsecurity=False).hexdigest()

    def cache_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.mp3"

    def cache_has(self, key: str) -> bool:
        path = self.cache_path(key)
        return path.is_file() and path.stat().st_size > 0

    # ---- translate ------------------------------------------------------ #
    async def translate(self, text: str, source: str | None, target: str) -> str:
        """Translate `text` from `source` to `target`; a no-op when they are the same."""
        text = text.strip()
        if not text:
            raise ValueError("Text is empty")
        self.check_language(target)
        if not source or source == target:
            return text
        self.check_language(source)
        try:
            translated = await asyncio.wait_for(
                self._translator.translate(text, source, target), self.timeout
            )
        except TtsError:
            raise
        except TimeoutError as exc:
            raise TtsError("Translation timed out") from exc
        except Exception as exc:
            raise TtsError(f"Translation failed: {exc}") from exc
        translated = (translated or "").strip()
        if not translated:
            raise TtsError("Translation returned an empty text")
        return translated

    # ---- synthesize ----------------------------------------------------- #
    async def ensure_audio(self, spoken_text: str, lang: str) -> TtsResult:
        """Return the cached MP3 for this text, synthesizing it first if needed.

        Concurrent requests for the same (text, lang) share one synthesis.
        """
        text = spoken_text.strip()
        if not text:
            raise ValueError("Text is empty")
        self.check_language(lang)
        key = self.cache_key(text, lang)
        path = self.cache_path(key)
        if self.cache_has(key):
            return TtsResult(text, key, path, True)

        job = self._inflight.get(key)
        if job is None:
            job = asyncio.ensure_future(self._synthesize(key, text, lang))
            self._inflight[key] = job
            job.add_done_callback(lambda _j, k=key: self._inflight.pop(k, None))
            job.add_done_callback(lambda j: j.cancelled() or j.exception())  # mark retrieved
        await asyncio.shield(job)
        return TtsResult(text, key, path, False)

    async def _synthesize(self, key: str, text: str, lang: str) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_dir / f"{key}.{uuid.uuid4().hex}.tmp"
        try:
            await asyncio.wait_for(
                self._synthesizer.synthesize(text, EDGE_VOICES[lang], tmp), self.timeout
            )
            if not tmp.is_file() or tmp.stat().st_size == 0:
                raise TtsError("TTS produced an empty file")
            os.replace(tmp, self.cache_path(key))
        except TtsError:
            raise
        except TimeoutError as exc:
            raise TtsError("TTS timed out") from exc
        except Exception as exc:
            raise TtsError(f"TTS failed: {exc}") from exc
        finally:
            tmp.unlink(missing_ok=True)

    async def generate(self, text: str, lang: str, source_lang: str | None = None) -> TtsResult:
        """Translate (if needed) -> cache lookup -> Edge-TTS."""
        spoken = await self.translate(text, source_lang, lang)
        return await self.ensure_audio(spoken, lang)

    # ---- store ---------------------------------------------------------- #
    async def store_audio(self, key: str, dest: Path) -> tuple[str, int]:
        """Copy a cached MP3 to `dest` atomically. Returns (sha256 hex, size in bytes)."""
        src = self.cache_path(key)

        def copy() -> tuple[str, int]:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(f"{dest.name}.{uuid.uuid4().hex}.tmp")
            digest, size = hashlib.sha256(), 0
            try:
                with open(src, "rb") as fin, open(tmp, "wb") as fout:
                    while chunk := fin.read(1 << 16):
                        digest.update(chunk)
                        fout.write(chunk)
                        size += len(chunk)
                os.replace(tmp, dest)
            finally:
                tmp.unlink(missing_ok=True)
            return digest.hexdigest(), size

        return await asyncio.to_thread(copy)
