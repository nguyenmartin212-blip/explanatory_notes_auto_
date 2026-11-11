// TtsService: translate (Google Translate via `google-translate-api-x`), speak with Edge-TTS
// (`node-edge-tts`), cache MP3 files.
// Flow (Chapter 06):  source text -> translate -> cache lookup -> Edge-TTS -> MP3 file.
// Cache key: MD5(`${text}:${lang}`) where `text` is the text that is actually spoken (after translation).
// MD5 is only a cache key here, not a security measure. The cache directory is separate from the public
// media directory; per-POI audio files are copies (see `storeAudio`), so deleting one POI's audio can never
// break another POI that happens to share the same spoken text.
// Both libraries are imported lazily and both backends are replaceable (constructor arguments), so the rest
// of the system and the tests do not need them installed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TtsError } from '../core/errors.js';

export const EDGE_VOICES = {
  vi: 'vi-VN-HoaiMyNeural',
  en: 'en-US-AriaNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
};
export const TRANSLATE_CODES = { vi: 'vi', en: 'en', zh: 'zh-CN', ja: 'ja', ko: 'ko' };

/** Default translator: translate(text, source, target) -> Promise<string>. */
export class GoogleTranslateBackend {
  async translate(text, source, target) {
    let mod;
    try {
      mod = await import('google-translate-api-x');
    } catch {
      throw new TtsError('google-translate-api-x is not installed');
    }
    const translate = mod.default ?? mod.translate;
    const result = await translate(text, { from: TRANSLATE_CODES[source], to: TRANSLATE_CODES[target] });
    return result.text;
  }
}

/** Default synthesizer: synthesize(text, voice, outPath) -> Promise<void>. */
export class EdgeTtsBackend {
  constructor(timeoutMs = 60000) { this.timeoutMs = timeoutMs; }

  async synthesize(text, voice, outPath) {
    let mod;
    try {
      mod = await import('node-edge-tts');
    } catch {
      throw new TtsError('node-edge-tts is not installed');
    }
    const lang = voice.split('-').slice(0, 2).join('-');
    const tts = new mod.EdgeTTS({
      voice,
      lang,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: this.timeoutMs,
    });
    await tts.ttsPromise(text, outPath);
  }
}

class Timeout extends Error {}

/** Promise.race with a timer that is always cleared. */
function withTimeout(promise, seconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Timeout('timeout')), seconds * 1000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class TtsService {
  constructor(settings, { translator = null, synthesizer = null } = {}) {
    this.cacheDir = settings.ttsCacheDir;
    this.timeout = settings.ttsTimeoutSeconds ?? 60;
    this.translator = translator || new GoogleTranslateBackend();
    this.synthesizer = synthesizer || new EdgeTtsBackend(this.timeout * 1000);
    this.inflight = new Map();
  }

  // ---- cache ------------------------------------------------------------------------------------
  static checkLanguage(lang) {
    if (!(lang in EDGE_VOICES)) {
      throw new RangeError(`Unsupported language '${lang}'; supported: ${JSON.stringify(Object.keys(EDGE_VOICES).sort())}`);
    }
  }

  static cacheKey(text, lang) {
    return crypto.createHash('md5').update(`${text}:${lang}`, 'utf8').digest('hex');
  }

  cacheKey(text, lang) { return TtsService.cacheKey(text, lang); }
  cachePath(key) { return path.join(this.cacheDir, `${key}.mp3`); }

  cacheHas(key) {
    try {
      const st = fs.statSync(this.cachePath(key));
      return st.isFile() && st.size > 0;
    } catch {
      return false;
    }
  }

  // ---- translate --------------------------------------------------------------------------------
  /** Translate `text` from `source` to `target`; a no-op when they are the same. */
  async translate(text, source, target) {
    const clean = (text || '').trim();
    if (!clean) throw new RangeError('Text is empty');
    TtsService.checkLanguage(target);
    if (!source || source === target) return clean;
    TtsService.checkLanguage(source);
    let translated;
    try {
      translated = await withTimeout(Promise.resolve(this.translator.translate(clean, source, target)), this.timeout);
    } catch (err) {
      if (err instanceof TtsError) throw err;
      if (err instanceof Timeout) throw new TtsError('Translation timed out');
      throw new TtsError(`Translation failed: ${err.message}`);
    }
    translated = (translated || '').trim();
    if (!translated) throw new TtsError('Translation returned an empty text');
    return translated;
  }

  // ---- synthesize -------------------------------------------------------------------------------
  /**
   * Return the cached MP3 for this text, synthesizing it first if needed.
   * Concurrent requests for the same (text, lang) share one synthesis.
   * -> { spokenText, cacheKey, cachePath, cacheHit }
   */
  async ensureAudio(spokenText, lang) {
    const text = (spokenText || '').trim();
    if (!text) throw new RangeError('Text is empty');
    TtsService.checkLanguage(lang);
    const key = this.cacheKey(text, lang);
    const file = this.cachePath(key);
    if (this.cacheHas(key)) return { spokenText: text, cacheKey: key, cachePath: file, cacheHit: true };

    let job = this.inflight.get(key);
    if (!job) {
      job = this.synthesizeToCache(key, text, lang).finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    await job;
    return { spokenText: text, cacheKey: key, cachePath: file, cacheHit: false };
  }

  async synthesizeToCache(key, text, lang) {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    const tmp = path.join(this.cacheDir, `${key}.${crypto.randomUUID().replaceAll('-', '')}.tmp`);
    const run = Promise.resolve(this.synthesizer.synthesize(text, EDGE_VOICES[lang], tmp));
    try {
      await withTimeout(run, this.timeout);
      let size = 0;
      try { size = (await fsp.stat(tmp)).size; } catch { /* missing */ }
      if (size === 0) throw new TtsError('TTS produced an empty file');
      await fsp.rename(tmp, this.cachePath(key));
    } catch (err) {
      if (err instanceof TtsError) throw err;
      if (err instanceof Timeout) {
        // the engine cannot be cancelled: remove whatever it writes after we gave up
        const late = () => fsp.unlink(tmp).catch(() => {});
        run.then(late, late);
        throw new TtsError('TTS timed out');
      }
      throw new TtsError(`TTS failed: ${err.message}`);
    } finally {
      await fsp.unlink(tmp).catch(() => {});
    }
  }

  /** Translate (if needed) -> cache lookup -> Edge-TTS. */
  async generate(text, lang, sourceLang = null) {
    const spoken = await this.translate(text, sourceLang, lang);
    return this.ensureAudio(spoken, lang);
  }

  // ---- store ------------------------------------------------------------------------------------
  /** Copy a cached MP3 to `dest` atomically. Returns { sha256, size }. */
  async storeAudio(key, dest) {
    const src = this.cachePath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${crypto.randomUUID().replaceAll('-', '')}.tmp`;
    try {
      const data = await fsp.readFile(src);
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, dest);
      return { sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length };
    } finally {
      await fsp.unlink(tmp).catch(() => {});
    }
  }
}
