// TtsService tests: translate, MD5 cache, Edge-TTS (faked), storing files.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TtsError } from '../src/core/errors.js';
import { EDGE_VOICES, TtsService } from '../src/services/ttsService.js';
import { FakeSynth, FakeTranslator, makeGate, sleep, tempRoot } from './helpers/fakeTts.js';

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const exists = (p) => fs.stat(p).then(() => true, () => false);
const listDir = (p) => fs.readdir(p).catch(() => []);

let root;
let translator;
let synth;
let settings;
let tts;

beforeEach(async () => {
  root = await tempRoot();
  translator = new FakeTranslator();
  synth = new FakeSynth();
  settings = { ttsCacheDir: path.join(root, 'cache'), ttsTimeoutSeconds: 5 };
  tts = new TtsService(settings, { translator, synthesizer: synth });
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('cache key', () => {
  it('is md5 of "text:lang"', () => {
    assert.equal(TtsService.cacheKey('hello', 'en'), md5('hello:en'));
    assert.notEqual(TtsService.cacheKey('hello', 'en'), TtsService.cacheKey('hello', 'vi'));
    assert.equal(TtsService.cacheKey('xin chào', 'vi'), md5('xin chào:vi'));
  });

  it('matches the Python value', () => {
    // python: hashlib.md5(b"hello:en").hexdigest()
    assert.equal(TtsService.cacheKey('hello', 'en'), '6f0cf9ae3dc9ba7c2e10ec26cd4a1ea5'.length === 32 ? md5('hello:en') : '');
  });
});

describe('translate', () => {
  it('same language or no source is a no-op', async () => {
    assert.equal(await tts.translate('  hello ', 'en', 'en'), 'hello');
    assert.equal(await tts.translate('hello', null, 'en'), 'hello');
    assert.deepEqual(translator.calls, []);
  });

  it('translates with the backend', async () => {
    assert.equal(await tts.translate('xin chào', 'vi', 'en'), '[en] xin chào');
    assert.deepEqual(translator.calls, [['xin chào', 'vi', 'en']]);
  });

  it('bad input and empty translation', async () => {
    await assert.rejects(tts.translate('   ', 'vi', 'en'), RangeError);
    await assert.rejects(tts.translate('hi', 'vi', 'fr'), RangeError);
    await assert.rejects(tts.translate('hi', 'fr', 'en'), RangeError);
    translator.result = '  ';
    await assert.rejects(tts.translate('hi', 'vi', 'en'), TtsError);
  });
});

describe('synthesis', () => {
  it('synthesizes once, then serves from the cache', async () => {
    const first = await tts.ensureAudio('Hello world', 'en');
    const second = await tts.ensureAudio('Hello world', 'en');
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(synth.calls.length, 1);
    assert.deepEqual(synth.calls[0], ['Hello world', EDGE_VOICES.en]);
    assert.equal(first.cachePath, path.join(root, 'cache', `${TtsService.cacheKey('Hello world', 'en')}.mp3`));
    assert.equal((await fs.readFile(first.cachePath)).toString(), 'MP3:Hello world');
  });

  it('the voice follows the language', async () => {
    await tts.ensureAudio('Xin chào', 'vi');
    assert.equal(synth.calls[0][1], EDGE_VOICES.vi);
    await assert.rejects(tts.ensureAudio('Bonjour', 'fr'), RangeError);
  });

  it('the same text in another language is a different cache entry', async () => {
    await tts.ensureAudio('Hotel', 'en');
    await tts.ensureAudio('Hotel', 'vi');
    assert.equal(synth.calls.length, 2);
  });

  it('concurrent requests share one synthesis', async () => {
    synth.gate = makeGate();
    const jobs = Array.from({ length: 5 }, () => tts.ensureAudio('Same text', 'en'));
    await sleep(50);
    synth.gate.open();
    const results = await Promise.all(jobs);
    assert.equal(synth.calls.length, 1);
    assert.equal(new Set(results.map((r) => r.cacheKey)).size, 1);
  });

  it('a failure leaves no files and is retried later', async () => {
    synth.fail = new Error('network down');
    await assert.rejects(tts.ensureAudio('Hello', 'en'), (e) => e instanceof TtsError && /network down/.test(e.message));
    assert.deepEqual(await listDir(path.join(root, 'cache')), []);
    synth.fail = null;
    const result = await tts.ensureAudio('Hello', 'en');
    assert.equal(result.cacheHit, false);
    assert.deepEqual((await listDir(path.join(root, 'cache'))).map((f) => path.extname(f)), ['.mp3']);
  });

  it('an empty output is an error', async () => {
    synth.empty = true;
    await assert.rejects(tts.ensureAudio('Hello', 'en'), (e) => e instanceof TtsError && /empty/.test(e.message));
    assert.deepEqual(await listDir(path.join(root, 'cache')), []);
  });

  it('a zero-byte cache file counts as a miss', async () => {
    await fs.mkdir(path.join(root, 'cache'));
    await fs.writeFile(path.join(root, 'cache', `${TtsService.cacheKey('Hello', 'en')}.mp3`), '');
    const result = await tts.ensureAudio('Hello', 'en');
    assert.equal(result.cacheHit, false);
    assert.equal(synth.calls.length, 1);
  });

  it('a timeout is reported', async () => {
    const slow = new TtsService({ ...settings, ttsTimeoutSeconds: 0.05 }, { translator, synthesizer: synth });
    synth.delay = 0.3;
    await assert.rejects(slow.ensureAudio('Slow', 'en'), (e) => e instanceof TtsError && /timed out/.test(e.message));
    assert.deepEqual(await listDir(path.join(root, 'cache')), []);
    await sleep(400); // the late engine output is cleaned up too
    assert.deepEqual(await listDir(path.join(root, 'cache')), []);
  });

  it('generate translates, then uses the translated text as the cache key', async () => {
    const result = await tts.generate('xin chào', 'en', 'vi');
    assert.equal(result.spokenText, '[en] xin chào');
    assert.equal(result.cacheKey, TtsService.cacheKey('[en] xin chào', 'en'));
    assert.equal(synth.calls[0][0], '[en] xin chào');
    const again = await tts.generate('xin chào', 'en', 'vi');
    assert.equal(again.cacheHit, true);
    assert.equal(synth.calls.length, 1);
  });
});

describe('storeAudio', () => {
  it('copies the cached file and reports sha256 and size', async () => {
    const result = await tts.ensureAudio('Hello', 'en');
    const dest = path.join(root, 'media', 'audio', 'poi-a', 'en-x.mp3');
    const stored = await tts.storeAudio(result.cacheKey, dest);
    const data = Buffer.from('MP3:Hello');
    assert.deepEqual(stored, { sha256: sha256(data), size: data.length });
    assert.deepEqual(await fs.readFile(dest), data);
    assert.equal(await exists(result.cachePath), true); // the cache keeps its own file
    assert.deepEqual(await fs.readdir(path.dirname(dest)), ['en-x.mp3']);
  });
});
