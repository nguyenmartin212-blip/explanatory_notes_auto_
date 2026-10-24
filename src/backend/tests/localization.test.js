// Chapter 08: content locale lane (hotset / on-demand / warmup) and UI bundles (static + long-tail).
// Real stores and services on the fake MongoDB; fake Redis; fake translators.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { RateLimited, NotFoundError } from '../src/core/errors.js';
import { parsePoiCreate, parsePoiUpdate } from '../src/schemas/content.js';
import * as svc from '../src/services/contentService.js';
import * as loc from '../src/services/localizationService.js';
import * as ui from '../src/services/uiBundleService.js';
import { TtsService } from '../src/services/ttsService.js';
import { FakeRedis } from './helpers/fakeRedis.js';
import { FakeSynth, FakeTranslator, makeGate, sleep, until } from './helpers/fakeTts.js';
import { makeWorld } from './helpers/world.js';

const HANOI = [21.0353, 105.8402];
const SETTINGS = {
  localizationHotsetRadiusM: 1500,
  localizationHotsetMaxPois: 10,
  localizationHotsetRequired: 3,
  localizationTranslateConcurrency: 3,
  localizationQueueMax: 1000,
  localizationOnDemandWaitSeconds: 0.3,
  localizationFailureCooldownSeconds: 60,
  localizationRateLimitRequests: 30,
  localizationRateLimitWindowSeconds: 60,
  localizationWarmupCooldownSeconds: 300,
  uiBundleLockSeconds: 600,
  uiBundleFailureCooldownSeconds: 300,
};

class FakeUiTranslator {
  constructor() { this.calls = []; this.fail = null; this.mangle = null; }

  async translateBatch(texts, source, target) {
    this.calls.push([texts.length, source, target]);
    if (this.fail) throw this.fail;
    return texts.map((t, i) => (this.mangle ? this.mangle(t, i) : `[${target}] ${t}`));
  }
}

let w, redis, translator, hydrator, tts, uiTranslator, abort, runner, clockNow;

beforeEach(async () => {
  w = await makeWorld(SETTINGS).init();
  redis = new FakeRedis();
  translator = new FakeTranslator();
  tts = new TtsService(w.settings, { translator, synthesizer: new FakeSynth() });
  uiTranslator = new FakeUiTranslator();
  clockNow = 1000;
  hydrator = new loc.LocalizationHydrator(w.db, w.settings, tts, { redis, uiTranslator, clock: () => clockNow });
  abort = runner = null;
});
afterEach(async () => {
  if (abort) abort.abort();
  if (runner) await runner.catch(() => {});
  w.cleanup();
});

const startWorkers = () => { abort = new AbortController(); runner = hydrator.run(abort.signal); };
const L = (name, description, extra = {}) => ({ name, description, ...extra });

/** Create an ACTIVE POI near Hanoi with the given localizations (English audio is made ready). */
async function activePoi(poiId, locs, { offsetM = 0, priority = 0 } = {}) {
  await svc.createPoi(w.db, w.settings, parsePoiCreate({
    poi_id: poiId, latitude: HANOI[0] + offsetM / 111_000, longitude: HANOI[1], priority, localizations: locs,
  }));
  if (locs.en) {
    w.touch(`audio/${poiId}.mp3`);
    await svc.completeAudio(w.db, w.settings, {
      poiId, language: 'en', contentHash: w.loc(poiId, 'en').content_hash, audioPath: `audio/${poiId}.mp3`, audioUrl: `/media/audio/${poiId}.mp3`,
    });
  }
  return svc.activatePoi(w.db, poiId, { force: true });
}

describe('pure rules', () => {
  const en = { name: 'A', description: 'a', content_hash: 'h1' };
  const vi = { name: 'V', description: 'v', content_hash: 'h2' };

  it('pickSource: English, then Vietnamese, never the target itself', () => {
    assert.deepEqual(loc.pickSource({ en, vi }, 'ja')[0], 'en');
    assert.deepEqual(loc.pickSource({ vi }, 'ja')[0], 'vi');
    assert.deepEqual(loc.pickSource({ en, vi }, 'en')[0], 'vi');
    assert.equal(loc.pickSource({}, 'ja'), null);
    assert.equal(loc.pickSource({ ja: en }, 'ja'), null);
  });

  it('needsTranslation: human content is never overwritten, stale machine translation is redone', () => {
    assert.equal(loc.needsTranslation(null, en), true);
    assert.equal(loc.needsTranslation({ name: 'x', description: 'y' }, en), false); // human
    const machine = { name: 'x', description: 'y', machine_translated: true, source_content_hash: 'h1' };
    assert.equal(loc.needsTranslation(machine, en), false);
    assert.equal(loc.needsTranslation({ ...machine, source_content_hash: 'old' }, en), true);
    assert.equal(loc.needsTranslation(null, null), false);
  });

  it('poiState: ready / pending / failed / no_source', () => {
    const ready = { ...en, audio_status: 'ready', audio_url: 'u', audio_hash: 'h1' };
    assert.equal(loc.poiState({ en: ready }, 'en').state, 'ready');
    assert.equal(loc.poiState({ en }, 'ja').state, 'pending');
    assert.deepEqual(loc.poiState({ en }, 'ja', 'boom'), { content_ready: false, audio_ready: false, state: 'failed', error: 'boom' });
    assert.equal(loc.poiState({}, 'ja').state, 'no_source');
  });

  it('checkLanguage rejects unsupported languages', () => {
    assert.throws(() => loc.checkLanguage('fr'), RangeError);
    loc.checkLanguage('ja');
  });
});

describe('hydratePoi', () => {
  it('translates from English, marks it as machine translated and queues the audio', async () => {
    await activePoi('p1', { en: L('Citadel', 'Old citadel', { tts_script: 'Spoken text' }) });
    assert.equal(await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ja'), 'translated');
    const ja = w.loc('p1', 'ja');
    assert.equal(ja.name, '[ja] Citadel');
    assert.equal(ja.description, '[ja] Old citadel');
    assert.equal(ja.tts_script, '[ja] Spoken text');
    assert.deepEqual([ja.machine_translated, ja.translated_from, ja.source_content_hash], [true, 'en', w.loc('p1', 'en').content_hash]);
    assert.ok(w.tasks().some((t) => t.poi_id === 'p1' && t.language === 'ja'));
    assert.ok(w.version() >= 2); // a public POI changed -> clients can sync it
  });

  it('is idempotent: a second call translates nothing', async () => {
    await activePoi('p1', { en: L('Citadel', 'Old citadel') });
    await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ja');
    const calls = translator.calls.length;
    assert.equal(await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ja'), 'present');
    assert.equal(translator.calls.length, calls);
  });

  it('never overwrites human-written content', async () => {
    await activePoi('p1', { en: L('Citadel', 'Old citadel'), ja: L('城', '古い城') });
    assert.equal(await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ja'), 'present');
    assert.equal(w.loc('p1', 'ja').name, '城');
    assert.deepEqual(translator.calls, []);
  });

  it('re-translates when the English source changed', async () => {
    await activePoi('p1', { en: L('Citadel', 'Old citadel') });
    await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ja');
    await svc.updatePoi(w.db, w.settings, 'p1', parsePoiUpdate({ localizations: { en: L('Citadel', 'New text') } }));
    assert.equal(await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ja'), 'translated');
    assert.equal(w.loc('p1', 'ja').description, '[ja] New text');
  });

  it('falls back to Vietnamese when there is no English; reports no_source when there is nothing', async () => {
    await activePoi('p1', { vi: L('Thăng Long', 'Mô tả') });
    assert.equal(await loc.hydratePoi(w.db, w.settings, tts, 'p1', 'ko'), 'translated');
    assert.equal(w.loc('p1', 'ko').translated_from, 'vi');
    await activePoi('p2', {});
    assert.equal(await loc.hydratePoi(w.db, w.settings, tts, 'p2', 'ko'), 'no_source');
  });

  it('unknown or draft POIs are not found', async () => {
    await assert.rejects(loc.hydratePoi(w.db, w.settings, tts, 'nope', 'ja'), NotFoundError);
    await svc.createPoi(w.db, w.settings, parsePoiCreate({ poi_id: 'draft', latitude: 1, longitude: 1, localizations: { en: L('D', 'd') } }));
    await assert.rejects(loc.hydratePoi(w.db, w.settings, tts, 'draft', 'ja'), NotFoundError);
  });
});

describe('hydrator queue', () => {
  it('priorities: required first, then hotset, then warmup; FIFO inside a priority', async () => {
    hydrator.enqueuePoi('w1', 'ja', loc.PRIORITY_WARMUP);
    hydrator.enqueuePoi('h1', 'ja', loc.PRIORITY_HOTSET);
    hydrator.enqueuePoi('r1', 'ja', loc.PRIORITY_REQUIRED);
    hydrator.enqueuePoi('h2', 'ja', loc.PRIORITY_HOTSET);
    assert.deepEqual(hydrator.heap.map((e) => e.item.poiId), ['r1', 'h1', 'h2', 'w1']);
  });

  it('duplicates are ignored and a full queue refuses', () => {
    const small = new loc.LocalizationHydrator(w.db, { ...w.settings, localizationQueueMax: 2 }, tts, { redis });
    assert.equal(small.enqueuePoi('a', 'ja'), 'queued');
    assert.equal(small.enqueuePoi('a', 'ja'), 'duplicate');
    assert.equal(small.enqueuePoi('b', 'ja'), 'queued');
    assert.equal(small.enqueuePoi('c', 'ja'), 'full');
  });

  it('workers hydrate queued POIs', async () => {
    await activePoi('p1', { en: L('A', 'a') });
    await activePoi('p2', { en: L('B', 'b') });
    startWorkers();
    hydrator.enqueuePoi('p1', 'ja');
    hydrator.enqueuePoi('p2', 'ja');
    await until(() => w.loc('p1', 'ja') && w.loc('p2', 'ja'));
    assert.equal(hydrator.pendingCount, 0);
  });

  it('a failure starts a cooldown; after it the POI can be queued again', async () => {
    await activePoi('p1', { en: L('A', 'a') });
    translator.translate = async () => { throw new Error('translator down'); };
    startWorkers();
    hydrator.enqueuePoi('p1', 'ja');
    await until(() => hydrator.failure('p1', 'ja'));
    assert.match(hydrator.failure('p1', 'ja'), /translator down|Translation failed/);
    assert.equal(hydrator.enqueuePoi('p1', 'ja'), 'cooldown');
    clockNow += 61;
    assert.equal(hydrator.enqueuePoi('p1', 'ja'), 'queued');
  });

  it('a slow translation never exceeds the concurrency limit', async () => {
    const small = new loc.LocalizationHydrator(w.db, { ...w.settings, localizationTranslateConcurrency: 2 }, tts, { redis });
    let active = 0;
    let max = 0;
    const gate = makeGate();
    tts.translate = async (text) => { active += 1; max = Math.max(max, active); await gate.promise; active -= 1; return text; };
    for (let i = 0; i < 4; i += 1) await activePoi(`p${i}`, { en: L(`N${i}`, `d${i}`) });
    abort = new AbortController();
    runner = small.run(abort.signal);
    for (let i = 0; i < 4; i += 1) small.enqueuePoi(`p${i}`, 'ja');
    await sleep(80);
    assert.ok(max <= 2 * 3, 'bounded'); // 3 fields per POI, 2 POIs at a time
    gate.open();
    await until(() => small.pendingCount === 0 && small.active.size === 0);
  });
});

describe('prepareHotset', () => {
  const call = (extra = {}) => loc.prepareHotset(w.db, redis, w.settings, hydrator, { lat: HANOI[0], lng: HANOI[1], lang: 'ja', client: 'c1', ...extra });

  it('queues the missing POIs and is not ready until the 3 required have content and audio', async () => {
    for (let i = 0; i < 4; i += 1) await activePoi(`p${i}`, { en: L(`N${i}`, `d${i}`) }, { offsetM: i * 100 });
    const first = await call();
    assert.equal(first.ready, false);
    assert.equal(first.count, 4);
    assert.deepEqual(first.required_poi_ids, ['p0', 'p1', 'p2']);
    assert.ok(first.pois.every((p) => p.state === 'pending'));
    assert.equal(hydrator.pendingCount, 4);
    assert.deepEqual(hydrator.heap.slice(0, 3).map((e) => e.priority), [0, 0, 0]); // required first

    startWorkers();
    await until(() => hydrator.pendingCount === 0 && hydrator.active.size === 0);
    // content is there, audio is still pending (the audio task has not run)
    assert.equal((await call()).ready, false);
    for (let i = 0; i < 3; i += 1) {
      w.touch(`audio/p${i}-ja.mp3`);
      await svc.completeAudio(w.db, w.settings, {
        poiId: `p${i}`, language: 'ja', contentHash: w.loc(`p${i}`, 'ja').content_hash,
        audioPath: `audio/p${i}-ja.mp3`, audioUrl: `/media/audio/p${i}-ja.mp3`,
      });
    }
    const done = await call();
    assert.equal(done.ready, true);
    assert.deepEqual(done.pois.filter((p) => p.required).map((p) => p.state), ['ready', 'ready', 'ready']);
  });

  it('only POIs inside the radius, at most 10, nearest first', async () => {
    for (let i = 0; i < 12; i += 1) await activePoi(`p${String(i).padStart(2, '0')}`, { en: L('N', 'd') }, { offsetM: 50 + i * 50 });
    await activePoi('far', { en: L('Far', 'd') }, { offsetM: 5000 });
    const r = await call();
    assert.equal(r.count, 10);
    assert.ok(!r.pois.some((p) => p.poi_id === 'far'));
    assert.deepEqual(r.pois.map((p) => p.poi_id), [...r.pois.map((p) => p.poi_id)].sort());
    assert.ok(r.pois.every((p, i, a) => i === 0 || a[i - 1].distance_m <= p.distance_m));
  });

  it('a POI without any source does not block the switch', async () => {
    await activePoi('p0', {});
    assert.equal((await call()).ready, true);
  });

  it('is rate limited per client with Retry-After', async () => {
    const strict = { ...w.settings, localizationRateLimitRequests: 2 };
    const run = () => loc.prepareHotset(w.db, redis, strict, hydrator, { lat: HANOI[0], lng: HANOI[1], lang: 'ja', client: 'c1' });
    await run();
    await run();
    await assert.rejects(run(), (err) => err instanceof RateLimited && err.retryAfter >= 1);
    await loc.prepareHotset(w.db, redis, strict, hydrator, { lat: HANOI[0], lng: HANOI[1], lang: 'ja', client: 'other' }); // another client is fine
  });

  it('rejects an unsupported language', async () => {
    await assert.rejects(call({ lang: 'fr' }), RangeError);
  });
});

describe('onDemand', () => {
  it('hydrates one POI now and returns its state and content', async () => {
    await activePoi('p1', { en: L('Citadel', 'Old citadel') });
    const r = await loc.onDemand(w.db, redis, w.settings, hydrator, { poiId: 'p1', lang: 'ja', client: 'c' });
    assert.equal(r.result, 'translated');
    assert.equal(r.content_ready, true);
    assert.equal(r.audio_ready, false); // audio is generated in the background
    assert.equal(r.content.language_served, 'ja');
    assert.equal(r.content.name, '[ja] Citadel');
  });

  it('unknown POI -> NotFoundError', async () => {
    await assert.rejects(loc.onDemand(w.db, redis, w.settings, hydrator, { poiId: 'nope', lang: 'ja', client: 'c' }), NotFoundError);
  });

  it('when no slot frees up in time the client is told to retry', async () => {
    await activePoi('p1', { en: L('A', 'a') });
    const gate = makeGate();
    const busy = new loc.LocalizationHydrator(w.db, { ...w.settings, localizationTranslateConcurrency: 1, localizationOnDemandWaitSeconds: 0.05 }, tts, { redis });
    tts.translate = async (text) => { await gate.promise; return text; };
    const first = busy.hydrateNow('p1', 'ja');
    await sleep(10);
    await assert.rejects(busy.hydrateNow('p1', 'ko'), (err) => err instanceof RateLimited && err.retryAfter >= 1);
    gate.open();
    await first;
  });
});

describe('warmup', () => {
  const call = (extra = {}) => loc.warmup(w.db, redis, w.settings, hydrator, { lang: 'ja', client: 'c', ...extra });

  it('queues the whole corpus at low priority, once per cooldown', async () => {
    await activePoi('p1', { en: L('A', 'a') });
    await activePoi('p2', { en: L('B', 'b') });
    const r = await call();
    assert.deepEqual([r.status, r.total_pois, r.queued], ['accepted', 2, 2]);
    assert.deepEqual(r.languages.ja, { queued: 2, already_ok: 0 });
    assert.ok(hydrator.heap.every((e) => e.priority === loc.PRIORITY_WARMUP));
    await assert.rejects(call(), (err) => err instanceof RateLimited && err.retryAfter > 1); // cooldown
    assert.equal((await call({ lang: 'ko' })).queued, 2); // another language has its own cooldown
  });

  it('without a language it warms every supported language', async () => {
    await activePoi('p1', { en: L('A', 'a') });
    const r = await call({ lang: null });
    assert.deepEqual(Object.keys(r.languages).sort(), ['en', 'ja', 'ko', 'vi', 'zh']);
    assert.equal(r.languages.en.already_ok, 1); // English text exists (audio is not part of "pending" for the text state)
  });
});

describe('UI bundles', () => {
  const get = (locale, extra = {}) => ui.getBundle(w.db, redis, w.settings, hydrator, locale, { client: 'c', ...extra });

  it('the 5 top-level languages are static and ready', async () => {
    for (const language of ui.STATIC_LOCALES) {
      const { body } = await get(language);
      assert.equal(body.status, 'ready');
      assert.equal(body.locale, language);
      assert.ok(Object.keys(body.strings).length >= 100);
    }
    assert.equal((await get('ja-JP')).body.locale, 'ja'); // region tags map to the base language
  });

  it('every static bundle has exactly the English keys', () => {
    const keys = Object.keys(ui.sourceStrings()).sort();
    for (const language of ui.STATIC_LOCALES) assert.deepEqual(Object.keys(ui.loadStatic(ui.NAMESPACE, language)).sort(), keys, language);
  });

  it('a long-tail locale: English + pending, then ready after the background translation', async () => {
    const first = await get('th');
    assert.deepEqual([first.body.status, first.body.fallback_locale, first.body.source_hash], ['pending', 'en', ui.sourceHash()]);
    assert.deepEqual(first.body.strings, ui.sourceStrings());
    assert.equal(hydrator.pendingCount, 1);
    assert.equal(await redis.exists('ui:lock:public-ui:th'), 1);
    assert.equal((await get('th')).body.status, 'pending');
    assert.equal(hydrator.pendingCount, 1); // not queued twice

    startWorkers();
    await until(() => w.db.collection('ui_bundles').docs.length === 1);
    const { body } = await get('th');
    assert.equal(body.status, 'ready');
    assert.ok(Object.values(body.strings).every((text) => text.startsWith('[th] ')));
    assert.equal(await redis.exists('ui:lock:public-ui:th'), 0); // lock released
    assert.ok(uiTranslator.calls.every(([, source, target]) => source === 'en' && target === 'th'));
    assert.equal(uiTranslator.calls.reduce((n, [c]) => n + c, 0), Object.keys(ui.sourceStrings()).length);
  });

  it('a translation made from an older English source is not served', async () => {
    await w.db.collection('ui_bundles').insertOne({ namespace: 'public-ui', locale: 'th', source_hash: 'old', strings: { a: 'b' }, updated_at: new Date() });
    assert.equal((await get('th')).body.status, 'pending');
  });

  it('placeholders must survive translation, otherwise English is kept for that string', async () => {
    const english = ui.sourceStrings();
    const key = Object.keys(english).find((k) => /\{[A-Za-z_]+\}/.test(english[k]));
    assert.ok(key, 'the bundle has at least one placeholder string');
    uiTranslator.mangle = (text) => text.replace(/\{[A-Za-z_]+\}/g, '{xxx}');
    await ui.translateBundle(w.db, redis, w.settings, uiTranslator, 'public-ui', 'th');
    const stored = w.db.collection('ui_bundles').docs[0];
    assert.equal(stored.strings[key], english[key]);
  });

  it('a failed translation -> failed status + cooldown, English served', async () => {
    uiTranslator.fail = new Error('quota');
    await redis.set('ui:lock:public-ui:th', '1', { EX: 600 });
    await ui.translateBundle(w.db, redis, w.settings, uiTranslator, 'public-ui', 'th');
    assert.equal(await redis.exists('ui:lock:public-ui:th'), 0);
    assert.equal(await redis.exists('ui:fail:public-ui:th'), 1);
    const { body } = await get('th');
    assert.deepEqual([body.status, body.fallback_locale], ['failed', 'en']);
    assert.equal(w.db.collection('ui_bundles').docs.length, 0);
  });

  it('incomplete translator output counts as a failure', async () => {
    uiTranslator.mangle = () => '';
    await ui.translateBundle(w.db, redis, w.settings, uiTranslator, 'public-ui', 'th');
    assert.equal(await redis.exists('ui:fail:public-ui:th'), 1);
  });

  it('the limiter holds a client back with a Retry-After', async () => {
    const strict = { ...w.settings, localizationRateLimitRequests: 1 };
    const one = (locale) => ui.getBundle(w.db, redis, strict, hydrator, locale, { client: 'c' });
    assert.equal((await one('th')).retryAfter, null);
    const limited = await one('id');
    assert.equal(limited.body.status, 'pending');
    assert.ok(limited.retryAfter >= 1);
  });

  it('a full queue answers failed instead of pending forever', async () => {
    const tiny = new loc.LocalizationHydrator(w.db, { ...w.settings, localizationQueueMax: 0 }, tts, { redis });
    const { body } = await ui.getBundle(w.db, redis, w.settings, tiny, 'th', { client: 'c' });
    assert.equal(body.status, 'failed');
    assert.equal(await redis.exists('ui:lock:public-ui:th'), 0);
  });

  it('works without Redis (single process)', async () => {
    const { body } = await ui.getBundle(w.db, null, w.settings, hydrator, 'th', { client: 'c' });
    assert.equal(body.status, 'pending');
  });

  it('normalizeLocale and ETag', () => {
    assert.equal(ui.normalizeLocale('PT_br'), 'pt');
    assert.equal(ui.normalizeLocale('zh-Hans-CN'), 'zh');
    for (const bad of ['', 'x', '../etc', 'a b', '12']) assert.throws(() => ui.normalizeLocale(bad), RangeError);
    assert.equal(ui.makeEtag('public-ui', 'th', 'ready', 'abc'), 'W/"ui-public-ui-th-ready-abc"');
    assert.match(ui.sourceHash(), /^[0-9a-f]{16}$/);
  });
});
