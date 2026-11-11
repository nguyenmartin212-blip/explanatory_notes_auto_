// AudioTaskManager, pack-manifest and SSE tests (real stores on the fake MongoDB, faked TTS backends).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ConflictError, NotFoundError } from '../src/core/errors.js';
import { parsePoiCreate, parsePoiUpdate } from '../src/schemas/content.js';
import * as audioPack from '../src/services/audioPack.js';
import * as audioSse from '../src/services/audioSse.js';
import { AudioTaskManager, taskView } from '../src/services/audioTaskManager.js';
import * as svc from '../src/services/contentService.js';
import { TtsService } from '../src/services/ttsService.js';
import { audioTaskStore } from '../src/stores/index.js';
import { FakeSynth, FakeTranslator, makeGate, sleep, until } from './helpers/fakeTts.js';
import { makeWorld } from './helpers/world.js';

const HANOI = [21.0353, 105.8402];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

let w, tts, translator, synth, manager, abort, runner;

async function setup() {
  w = await makeWorld().init();
  translator = new FakeTranslator();
  synth = new FakeSynth();
  tts = new TtsService(w.settings, { translator, synthesizer: synth });
  manager = new AudioTaskManager(w.db, w.settings, tts);
  abort = null;
  runner = null;
}
const start = (m = manager) => { abort = new AbortController(); runner = m.run(abort.signal); };
async function stop() {
  if (abort) abort.abort();
  if (runner) await runner.catch(() => {});
  abort = runner = null;
}
beforeEach(setup);
afterEach(async () => { await stop(); w.cleanup(); });

const createData = (poiId, { en = 'Citadel text', vi = null, tts_script = null } = {}) => {
  const localizations = { en: { name: poiId, description: en, tts_script } };
  if (vi) localizations.vi = { name: poiId, description: vi };
  return parsePoiCreate({ poi_id: poiId, latitude: HANOI[0], longitude: HANOI[1], localizations });
};
const create = (poiId, opts) => svc.createPoi(w.db, w.settings, createData(poiId, opts));
const update = (poiId, obj) => svc.updatePoi(w.db, w.settings, poiId, parsePoiUpdate(obj));
const task = (poiId, language = 'en') => w.tasks().find((t) => t.poi_id === poiId && t.language === language);
const untilStatus = (poiId, status, language = 'en') => until(
  () => task(poiId, language)?.status === status,
  { describe: () => JSON.stringify(w.tasks().map((t) => [t.poi_id, t.status, t.stage])) },
);

describe('pipeline', () => {
  it('end to end: generates, stores and updates the localization', async () => {
    await create('poi-a', { en: 'The Citadel' });
    assert.equal(task('poi-a').status, 'queued');
    start();
    await untilStatus('poi-a', 'completed');

    const key = TtsService.cacheKey('The Citadel', 'en');
    const rel = `audio/poi-a/en-${key}.mp3`;
    const data = Buffer.from('MP3:The Citadel');
    const t = task('poi-a');
    const loc = w.loc('poi-a', 'en');
    assert.deepEqual([t.progress, t.stage, t.result, t.cache_hit], [100, 'completed', 'ok', false]);
    assert.equal(t.audio_url, `/media/${rel}`);
    assert.equal(loc.audio_status, 'ready');
    assert.deepEqual([loc.audio_path, loc.audio_url], [rel, `/media/${rel}`]);
    assert.deepEqual([loc.audio_sha256, loc.audio_size], [sha(data), data.length]);
    assert.equal(loc.audio_hash, loc.content_hash);
    assert.deepEqual(fs.readFileSync(path.join(w.settings.mediaDir, rel)), data);
    assert.deepEqual(synth.calls, [['The Citadel', 'en-US-AriaNeural']]);
    assert.equal((await svc.checkReadiness(w.db, 'poi-a')).ready, true);
  });

  it('the tts_script is what gets spoken', async () => {
    await create('poi-a', { en: 'Long text', tts_script: 'Short script' });
    start();
    await untilStatus('poi-a', 'completed');
    assert.equal(synth.calls[0][0], 'Short script');
  });

  it('identical text reuses the cache but each POI gets its own file', async () => {
    await create('poi-a', { en: 'Same words' });
    await create('poi-b', { en: 'Same words' });
    start();
    await untilStatus('poi-a', 'completed');
    await untilStatus('poi-b', 'completed');
    assert.equal(synth.calls.length, 1); // the two runs shared one synthesis
    await create('poi-c', { en: 'Same words' });
    await untilStatus('poi-c', 'completed');
    assert.equal(synth.calls.length, 1);
    assert.equal(task('poi-c').cache_hit, true);
    const [a, b] = [w.loc('poi-a', 'en').audio_path, w.loc('poi-b', 'en').audio_path];
    assert.notEqual(a, b);
    assert.ok(w.exists(a) && w.exists(b));
  });

  it('a source language is translated before synthesis', async () => {
    await create('poi-a', { en: 'Old english', vi: 'Xin chào' });
    const enHash = w.loc('poi-a', 'en').content_hash;
    await audioTaskStore.enqueue(w.db, { poiId: 'poi-a', language: 'en', text: 'Xin chào', contentHash: enHash, sourceLang: 'vi' });
    start();
    await untilStatus('poi-a', 'completed');
    assert.deepEqual(translator.calls, [['Xin chào', 'vi', 'en']]);
    assert.ok(synth.calls.some(([text, voice]) => text === '[en] Xin chào' && voice === 'en-US-AriaNeural'));
    assert.equal(w.loc('poi-a', 'en').audio_status, 'ready');
  });

  it('discards a task whose localization disappeared', async () => {
    await create('poi-a');
    w.locs().length = 0;
    start();
    await untilStatus('poi-a', 'completed');
    assert.equal(task('poi-a').result, 'discarded');
    assert.deepEqual(synth.calls, []);
  });

  it('fails with a clear error when media storage is disabled', async () => {
    w.settings.mediaStorageBackend = 'none';
    await create('poi-a');
    start();
    await untilStatus('poi-a', 'failed');
    assert.match(task('poi-a').error, /Media storage is disabled/);
  });
});

describe('concurrency', () => {
  it('at most three tasks run at the same time', async () => {
    synth.gate = makeGate();
    for (let i = 0; i < 6; i += 1) await create(`poi-${i}`, { en: `Distinct text ${i}` });
    start();
    await until(() => synth.active === 3);
    await sleep(100); // give a 4th task every chance to start
    assert.deepEqual(w.tasks().map((t) => t.status).sort(), ['queued', 'queued', 'queued', 'running', 'running', 'running']);
    assert.deepEqual([manager.runningCount, synth.maxActive], [3, 3]);

    synth.gate.open();
    await until(() => w.tasks().every((t) => t.status === 'completed'));
    assert.equal(synth.maxActive, 3);
    assert.equal(synth.calls.length, 6);
  });

  it('queued tasks run oldest first', async () => {
    const order = [];
    const original = synth.synthesize.bind(synth);
    synth.synthesize = async (text, voice, out) => { order.push(text); return original(text, voice, out); };
    const single = new AudioTaskManager(w.db, { ...w.settings, audioMaxConcurrency: 1 }, tts);
    for (let i = 0; i < 4; i += 1) { await create(`poi-${i}`, { en: `Text ${i}` }); await sleep(2); }
    start(single);
    await until(() => w.tasks().every((t) => t.status === 'completed'));
    assert.deepEqual(order, [0, 1, 2, 3].map((i) => `Text ${i}`));
  });
});

describe('admin control', () => {
  it('pause a queued task, then resume', async () => {
    await create('poi-a');
    const id = task('poi-a').task_id;
    assert.equal((await manager.pause(id)).status, 'paused');
    start();
    await sleep(100);
    assert.equal(task('poi-a').status, 'paused'); // never claimed
    assert.deepEqual(synth.calls, []);
    assert.equal((await manager.resume(id)).status, 'queued');
    await untilStatus('poi-a', 'completed');
  });

  it('cancel a queued task, then retry', async () => {
    await create('poi-a');
    const id = task('poi-a').task_id;
    assert.equal((await manager.cancel(id)).status, 'cancelled');
    assert.ok(task('poi-a').finished_at);
    start();
    await sleep(60);
    assert.deepEqual(synth.calls, []);
    assert.equal((await manager.retry(id)).status, 'queued');
    await untilStatus('poi-a', 'completed');
    assert.equal(w.loc('poi-a', 'en').audio_status, 'ready');
  });

  it('cancel a running task stops it before saving', async () => {
    synth.gate = makeGate();
    await create('poi-a');
    const id = task('poi-a').task_id;
    start();
    await until(() => synth.active === 1);
    const view = await manager.cancel(id);
    assert.deepEqual([view.status, view.interrupt_requested], ['running', 'cancel']);
    synth.gate.open();
    await untilStatus('poi-a', 'cancelled');
    assert.equal(w.loc('poi-a', 'en').audio_status, 'pending');
    assert.equal(fs.readdirSync(w.settings.mediaDir).length, 0); // nothing was saved
    assert.equal(manager.runningCount, 0);
  });

  it('pause a running task, then resume finishes from the cache', async () => {
    synth.gate = makeGate();
    await create('poi-a');
    const id = task('poi-a').task_id;
    start();
    await until(() => synth.active === 1);
    await manager.pause(id);
    synth.gate.open();
    await untilStatus('poi-a', 'paused');
    await manager.resume(id);
    await untilStatus('poi-a', 'completed');
    assert.equal(synth.calls.length, 1); // not synthesized twice
    assert.equal(task('poi-a').cache_hit, true);
  });

  it('invalid actions are rejected', async () => {
    await create('poi-a');
    const id = task('poi-a').task_id;
    await assert.rejects(manager.pause('nope'), NotFoundError);
    await assert.rejects(manager.resume(id), ConflictError); // queued, not paused
    await assert.rejects(manager.retry(id), ConflictError); // queued, not failed/cancelled
    start();
    await untilStatus('poi-a', 'completed');
    for (const action of ['pause', 'cancel', 'resume', 'retry']) {
      await assert.rejects(manager[action](id), ConflictError);
    }
  });
});

describe('failure and content changes', () => {
  it('failure marks the task and the localization; retry succeeds', async () => {
    synth.fail = new Error('edge-tts unreachable');
    await create('poi-a');
    const id = task('poi-a').task_id;
    start();
    await untilStatus('poi-a', 'failed');
    assert.match(task('poi-a').error, /edge-tts unreachable/);
    assert.equal(w.loc('poi-a', 'en').audio_status, 'failed');
    assert.equal(manager.runningCount, 0);

    synth.fail = null;
    await manager.retry(id);
    assert.equal(w.loc('poi-a', 'en').audio_status, 'pending');
    await untilStatus('poi-a', 'completed');
    assert.equal(w.loc('poi-a', 'en').audio_status, 'ready');
    assert.equal(task('poi-a').attempts, 2);
  });

  it('text changed while running: old audio is discarded and the task runs again', async () => {
    synth.gate = makeGate();
    await create('poi-a', { en: 'Old text' });
    start();
    await until(() => synth.active === 1);
    await update('poi-a', { localizations: { en: { name: 'poi-a', description: 'New text' } } });
    assert.equal(task('poi-a').rerun, true);
    synth.gate.open();
    await until(() => task('poi-a').status === 'completed' && w.loc('poi-a', 'en').audio_status === 'ready');

    assert.deepEqual(synth.calls.map((c) => c[0]), ['Old text', 'New text']);
    const loc = w.loc('poi-a', 'en');
    assert.equal(loc.audio_hash, loc.content_hash);
    assert.equal(loc.audio_path, `audio/poi-a/en-${TtsService.cacheKey('New text', 'en')}.mp3`);
    assert.equal(w.exists(`audio/poi-a/en-${TtsService.cacheKey('Old text', 'en')}.mp3`), false); // stale copy removed
    assert.equal(task('poi-a').result, 'ok');
  });

  it('taskView is JSON serializable', async () => {
    await create('poi-a');
    const view = taskView(task('poi-a'));
    JSON.parse(JSON.stringify(view));
    assert.deepEqual([view.status, view.language, view.progress], ['queued', 'en', 0]);
  });

  it('restart recovery requeues running tasks (paused stay paused)', async () => {
    await create('poi-a');
    await create('poi-b', { en: 'B text' });
    task('poi-a').status = 'running';
    task('poi-b').status = 'paused';
    const { recoverAudioTasks } = await import('../src/services/audioRecovery.js');
    assert.equal(await recoverAudioTasks(w.db), 1);
    assert.equal(task('poi-a').status, 'queued');
    assert.equal(task('poi-b').status, 'paused');
  });

  it('stale running tasks are requeued', async () => {
    await create('poi-a');
    Object.assign(task('poi-a'), { status: 'running', updated_at: new Date(Date.now() - 3600_000) });
    assert.equal(await audioTaskStore.requeueStaleRunning(w.db, 900), 1);
    assert.equal(task('poi-a').status, 'queued');
  });
});

describe('pack manifest', () => {
  async function makePublic(poiId, text, seed) {
    await create(poiId, { en: text });
    await svc.completeAudio(w.db, w.settings, {
      poiId, language: 'en', contentHash: w.loc(poiId, 'en').content_hash,
      audioPath: `audio/${poiId}/en.mp3`, audioUrl: `/media/audio/${poiId}/en.mp3`, audioSha256: sha(seed), audioSize: 100,
    });
    await svc.activatePoi(w.db, poiId);
  }

  it('lists files with size, sha256 and a content-addressed version', async () => {
    const empty = await audioPack.buildManifest(w.db);
    assert.deepEqual([empty.count, empty.files], [0, []]);

    await makePublic('poi-a', 'Text A', 'a');
    await makePublic('poi-b', 'Text B', 'b');
    const manifest = await audioPack.buildManifest(w.db);
    assert.deepEqual(manifest.files.map((f) => f.poi_id), ['poi-a', 'poi-b']);
    assert.deepEqual(manifest.files[0], {
      poi_id: 'poi-a', language: 'en', url: '/media/audio/poi-a/en.mp3', path: 'audio/poi-a/en.mp3', size: 100, sha256: sha('a'),
    });
    assert.deepEqual([manifest.count, manifest.total_bytes], [2, 200]);
    assert.equal(manifest.dataset_version, w.version());
    assert.equal((await audioPack.buildManifest(w.db)).pack_version, manifest.pack_version); // stable

    await update('poi-a', { localizations: { en: { name: 'poi-a', description: 'Changed' } } });
    await svc.completeAudio(w.db, w.settings, {
      poiId: 'poi-a', language: 'en', contentHash: w.loc('poi-a', 'en').content_hash,
      audioPath: 'audio/poi-a/en2.mp3', audioUrl: '/media/audio/poi-a/en2.mp3', audioSha256: sha('a2'), audioSize: 120,
    });
    const changed = await audioPack.buildManifest(w.db);
    assert.notEqual(changed.pack_version, manifest.pack_version);
    assert.equal(changed.total_bytes, 220);
  });

  it('only public, ready, current audio is listed', async () => {
    await makePublic('poi-a', 'Text A', 'a');
    await create('poi-draft', { en: 'Draft text' }); // draft
    await svc.completeAudio(w.db, w.settings, {
      poiId: 'poi-draft', language: 'en', contentHash: w.loc('poi-draft', 'en').content_hash,
      audioPath: 'audio/poi-draft/en.mp3', audioUrl: 'u', audioSha256: 'x'.repeat(64), audioSize: 1,
    });
    await makePublic('poi-stale', 'Old', 's'); // public, then its text changes: the audio is stale
    await update('poi-stale', { localizations: { en: { name: 'poi-stale', description: 'New' } } });
    assert.deepEqual((await audioPack.buildManifest(w.db)).files.map((f) => f.poi_id), ['poi-a']);
  });

  it('language filter', async () => {
    await create('poi-a', { en: 'English', vi: 'Tiếng Việt' });
    for (const language of ['en', 'vi']) {
      await svc.completeAudio(w.db, w.settings, {
        poiId: 'poi-a', language, contentHash: w.loc('poi-a', language).content_hash,
        audioPath: `audio/poi-a/${language}.mp3`, audioUrl: `/m/${language}`, audioSha256: language.repeat(32), audioSize: 1,
      });
    }
    await svc.activatePoi(w.db, 'poi-a');
    assert.equal((await audioPack.buildManifest(w.db)).files.length, 2);
    assert.deepEqual((await audioPack.buildManifest(w.db, { lang: 'vi' })).files.map((f) => f.language), ['vi']);
  });

  it('etag', () => assert.equal(audioPack.makePackEtag('abc'), 'W/"pack-abc"'));
});

describe('SSE', () => {
  /** Run the stream for `ticks` polling rounds, applying hooks[i] before round i. */
  async function collect(ticks, hooks = {}, opts = {}) {
    const state = { round: 0, now: 0 };
    const chunks = [];
    const stream = audioSse.eventStream(w.db, {
      isDisconnected: async () => state.round >= ticks,
      sleep: async () => {
        const hook = hooks[state.round];
        state.round += 1;
        if (hook) await hook();
      },
      clock: () => { state.now += 10; return state.now; },
      ...opts,
    });
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
  }
  const parse = (chunk) => {
    const [first, second] = chunk.trim().split('\n');
    return [first.replace('event: ', ''), JSON.parse(second.replace('data: ', ''))];
  };

  it('format', () => assert.equal(audioSse.formatSse('task', { a: 'é' }), 'event: task\ndata: {"a":"é"}\n\n'));

  it('snapshot, then changes, then keepalive', async () => {
    await create('poi-a');
    await create('poi-b', { en: 'Other text' });
    const id = task('poi-a').task_id;
    const chunks = await collect(5, { 0: () => manager.pause(id), 1: () => manager.cancel(id) }, { keepaliveSeconds: 15 });
    const [event, snapshot] = parse(chunks[0]);
    assert.equal(event, 'snapshot');
    assert.deepEqual(new Set(snapshot.tasks.map((t) => t.poi_id)), new Set(['poi-a', 'poi-b']));
    const changes = chunks.slice(1).filter((c) => c.startsWith('event: task')).map(parse);
    assert.deepEqual(changes.map(([e, t]) => [e, t.poi_id, t.status]), [['task', 'poi-a', 'paused'], ['task', 'poi-a', 'cancelled']]);
    assert.ok(chunks.includes(': keepalive\n\n'));
  });

  it('nothing is repeated when nothing changes', async () => {
    await create('poi-a');
    assert.equal((await collect(4, {}, { keepaliveSeconds: 10_000 })).length, 1); // only the snapshot
  });

  it('progress updates are streamed', async () => {
    await create('poi-a');
    synth.gate = makeGate();
    const chunks = await collect(3, {
      0: async () => { start(); await until(() => synth.active === 1); },
      1: async () => { synth.gate.open(); await untilStatus('poi-a', 'completed'); },
    }, { keepaliveSeconds: 10_000 });
    const seen = chunks.filter((c) => c.startsWith('event: task')).map((c) => parse(c)[1]);
    assert.equal(seen.at(-1).status, 'completed');
    assert.equal(seen.at(-1).progress, 100);
    assert.ok(seen.some((t) => t.stage === 'synthesizing'));
  });
});
