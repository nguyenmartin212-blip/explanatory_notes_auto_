// Lifecycle / sync / nearby tests: the REAL stores and services run on an in-memory fake MongoDB.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ConflictError, NotFoundError, NotReadyError } from '../src/core/errors.js';
import { parsePoiCreate, parsePoiUpdate } from '../src/schemas/content.js';
import * as svc from '../src/services/contentService.js';
import * as poiNearby from '../src/services/poiNearby.js';
import * as poiSync from '../src/services/poiSync.js';
import { makeWorld } from './helpers/world.js';

const HANOI = [21.0353, 105.8402];
const NEAR_HANOI = [21.036, 105.8405]; // ~85 m away
const HUE = [16.469, 107.5788];

const loc = (name, description = 'Mô tả', tts = null) => ({ name, description, tts_script: tts });
const update = (obj) => parsePoiUpdate(obj);

function setup() {
  const w = makeWorld();
  const ctx = {
    w,
    db: w.db,
    settings: w.settings,
    create(opts = {}) {
      const { poi_id = 'hanoi-thang-long', coords = HANOI, locs, ...extra } = opts;
      return svc.createPoi(w.db, w.settings, parsePoiCreate({
        poi_id,
        latitude: coords[0],
        longitude: coords[1],
        localizations: locs ?? { vi: loc('Thăng Long'), en: loc('Thang Long', 'Citadel') },
        ...extra,
      }));
    },
    /** Complete English audio for the current text. */
    makeReady(poiId = 'hanoi-thang-long', file = 'audio/a.mp3') {
      w.touch(file);
      return svc.completeAudio(w.db, w.settings, {
        poiId, language: 'en', contentHash: w.loc(poiId, 'en').content_hash, audioPath: file, audioUrl: `/static/${file}`,
      });
    },
    async createActive(opts = {}) {
      const poiId = opts.poi_id ?? 'hanoi-thang-long';
      await ctx.create(opts);
      await ctx.makeReady(poiId, `audio/${poiId}-en.mp3`);
      return svc.activatePoi(w.db, poiId);
    },
    load: (opts = {}) => poiSync.loadAll(w.db, opts),
    update: (poiId, obj) => svc.updatePoi(w.db, w.settings, poiId, update(obj)),
    queuedPairs: () => w.tasks().map((t) => `${t.poi_id}/${t.language}`).sort(),
  };
  return ctx;
}

let t;
beforeEach(async () => { t = setup(); await t.w.init(); });
afterEach(() => t.w.cleanup());

describe('create', () => {
  it('is draft, queues audio and is not public', async () => {
    const view = await t.create();
    assert.equal(view.status, 'draft');
    assert.equal(view.radius_meters, 80);
    assert.deepEqual(t.queuedPairs(), ['hanoi-thang-long/en', 'hanoi-thang-long/vi']);
    assert.equal(view.localizations.en.audio_status, 'pending');
    assert.equal(t.w.version(), 0);
    assert.deepEqual((await t.load()).pois, []);
  });

  it('duplicate id conflicts', async () => {
    await t.create();
    await assert.rejects(t.create(), ConflictError);
  });

  it('generates an id when missing', async () => {
    const view = await svc.createPoi(t.db, t.settings, parsePoiCreate({ latitude: 1, longitude: 2 }));
    assert.ok(view.poi_id.startsWith('poi-'));
    assert.deepEqual(t.w.tasks(), []); // no text -> no audio task
  });
});

describe('activation', () => {
  it('requires English content then English audio', async () => {
    await t.create({ locs: { vi: loc('Thăng Long') } });
    await assert.rejects(svc.activatePoi(t.db, 'hanoi-thang-long'), (e) => e instanceof NotReadyError && e.report.missing.join() === 'en_content');

    await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long', 'Citadel') } });
    await assert.rejects(svc.activatePoi(t.db, 'hanoi-thang-long'), (e) => e instanceof NotReadyError && e.report.missing.join() === 'en_audio');
    assert.equal(t.w.version(), 0);

    await t.makeReady();
    const view = await svc.activatePoi(t.db, 'hanoi-thang-long');
    assert.equal(view.status, 'active');
    assert.equal(t.w.version(), 1);
    assert.equal(view.dataset_version, 1);
    assert.deepEqual((await t.load()).pois.map((p) => p.poi_id), ['hanoi-thang-long']);
  });

  it('is idempotent and an unknown POI is not found', async () => {
    await t.createActive();
    await svc.activatePoi(t.db, 'hanoi-thang-long');
    assert.equal(t.w.version(), 1);
    await assert.rejects(svc.activatePoi(t.db, 'missing-poi'), NotFoundError);
  });

  it('force skips the readiness check (seed script only)', async () => {
    await t.create({ locs: { vi: loc('Thăng Long') } });
    const view = await svc.activatePoi(t.db, 'hanoi-thang-long', { force: true });
    assert.equal(view.status, 'active');
  });
});

describe('audio handling', () => {
  it('a stale audio result is discarded', async () => {
    await t.create();
    const oldHash = t.w.loc('hanoi-thang-long', 'en').content_hash;
    await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long', 'A new description') } });
    t.w.touch('audio/old.mp3');
    const ok = await svc.completeAudio(t.db, t.settings, {
      poiId: 'hanoi-thang-long', language: 'en', contentHash: oldHash, audioPath: 'audio/old.mp3', audioUrl: 'u',
    });
    assert.equal(ok, false);
    assert.equal(t.w.exists('audio/old.mp3'), false);
    assert.equal(t.w.loc('hanoi-thang-long', 'en').audio_status, 'pending');
  });

  it('audio for a deleted POI is discarded', async () => {
    await t.create();
    const h = t.w.loc('hanoi-thang-long', 'en').content_hash;
    await svc.deletePoi(t.db, t.settings, 'hanoi-thang-long');
    t.w.touch('audio/late.mp3');
    const ok = await svc.completeAudio(t.db, t.settings, {
      poiId: 'hanoi-thang-long', language: 'en', contentHash: h, audioPath: 'audio/late.mp3', audioUrl: 'u',
    });
    assert.equal(ok, false);
    assert.equal(t.w.exists('audio/late.mp3'), false);
  });

  it('a text change on a draft drops the old audio without a version bump', async () => {
    await t.create();
    await t.makeReady('hanoi-thang-long', 'audio/v1.mp3');
    t.w.clearTasks();
    const view = await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long', 'Changed text') } });
    assert.equal(view.localizations.en.audio_status, 'pending');
    assert.equal(view.localizations.en.audio_url, null);
    assert.equal(t.w.exists('audio/v1.mp3'), false);
    assert.deepEqual(t.queuedPairs(), ['hanoi-thang-long/en']);
    assert.equal(t.w.version(), 0);
  });

  it('a text change on an active POI bumps the version and hides the old audio', async () => {
    await t.createActive();
    assert.equal(t.w.version(), 1);
    await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long', 'Changed text') } });
    assert.equal(t.w.version(), 2);
    let pub = (await t.load()).pois[0];
    assert.equal(pub.localizations.en.audio_url, null);
    // POI stays public while its audio is regenerated; new audio bumps again.
    await t.makeReady('hanoi-thang-long', 'audio/v2.mp3');
    assert.equal(t.w.version(), 3);
    pub = (await t.load()).pois[0];
    assert.equal(pub.localizations.en.audio_url, '/static/audio/v2.mp3');
    assert.equal(t.w.exists('audio/hanoi-thang-long-en.mp3'), false);
  });

  it('an update without a text change keeps the audio and does not requeue', async () => {
    await t.createActive();
    t.w.clearTasks();
    // Same description/tts, new name: audio text is the same -> audio is kept.
    const view = await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long Citadel', 'Citadel') } });
    assert.equal(view.localizations.en.audio_status, 'ready');
    assert.deepEqual(t.w.tasks(), []);
    assert.equal(t.w.version(), 2); // the name change is visible to clients
  });

  it('an identical update does not bump the version', async () => {
    await t.createActive();
    await t.update('hanoi-thang-long', { radius_meters: 80 });
    await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long', 'Citadel') } });
    assert.equal(t.w.version(), 1);
    await t.update('hanoi-thang-long', { radius_meters: 75 });
    assert.equal(t.w.version(), 2);
  });

  it('a failed audio is retried on the next update', async () => {
    await t.create();
    const h = t.w.loc('hanoi-thang-long', 'en').content_hash;
    await svc.failAudio(t.db, { poiId: 'hanoi-thang-long', language: 'en', contentHash: h, error: 'tts down' });
    assert.equal(t.w.loc('hanoi-thang-long', 'en').audio_status, 'failed');
    t.w.clearTasks();
    await t.update('hanoi-thang-long', { localizations: { en: loc('Thang Long', 'Citadel') } });
    assert.deepEqual(t.queuedPairs(), ['hanoi-thang-long/en']);
  });
});

describe('delete', () => {
  it('deleting a public POI cleans everything and leaves a tombstone', async () => {
    await t.createActive();
    await svc.deletePoi(t.db, t.settings, 'hanoi-thang-long');
    assert.deepEqual(t.w.pois(), []);
    assert.deepEqual(t.w.locs(), []);
    assert.deepEqual(t.w.tasks(), []);
    assert.equal(t.w.exists('audio/hanoi-thang-long-en.mp3'), false);
    assert.equal(t.w.version(), 2);
    assert.ok(t.w.tombstones().some((x) => x.poi_id === 'hanoi-thang-long'));
  });

  it('deleting a draft has no public effect', async () => {
    await t.create();
    await svc.deletePoi(t.db, t.settings, 'hanoi-thang-long');
    assert.equal(t.w.version(), 0);
    assert.deepEqual(t.w.tombstones(), []);
    await assert.rejects(svc.deletePoi(t.db, t.settings, 'hanoi-thang-long'), NotFoundError);
  });
});

describe('sync', () => {
  it('full sync shape', async () => {
    await t.createActive();
    const r = await t.load({ lang: 'zh' });
    assert.deepEqual([r.sync_mode, r.dataset_version, r.removed_poi_ids], ['full', 1, []]);
    assert.equal(poiSync.decodeCursor(r.sync_cursor), 1);
    const poi = r.pois[0];
    assert.equal(poi.content.language_served, 'en'); // zh missing -> English
    assert.equal(poi.content.fallback, true);
    assert.equal(poi.localizations.en.audio_url, '/static/audio/hanoi-thang-long-en.mp3');
    assert.deepEqual([poi.latitude, poi.longitude], HANOI);
  });

  it('delta returns only changes and removed ids', async () => {
    await t.createActive({ poi_id: 'poi-a' });
    await t.createActive({ poi_id: 'poi-b', coords: HUE });
    await t.createActive({ poi_id: 'poi-c', coords: NEAR_HANOI });
    const cursor = (await t.load()).sync_cursor;

    let r = await t.load({ syncCursor: cursor });
    assert.deepEqual([r.sync_mode, r.pois, r.removed_poi_ids], ['delta', [], []]);

    await t.update('poi-a', { priority: 5 });
    await svc.deletePoi(t.db, t.settings, 'poi-b');
    r = await t.load({ syncCursor: cursor });
    assert.equal(r.sync_mode, 'delta');
    assert.deepEqual(r.pois.map((p) => p.poi_id), ['poi-a']);
    assert.deepEqual(r.removed_poi_ids, ['poi-b']);
    assert.equal(r.pois[0].priority, 5);

    // Advancing the cursor leaves nothing to send.
    const r2 = await t.load({ syncCursor: r.sync_cursor });
    assert.deepEqual([r2.pois, r2.removed_poi_ids], [[], []]);
  });

  it('an invalid, future or forced-full cursor gives a full sync', async () => {
    await t.createActive();
    const cases = [
      { syncCursor: 'garbage' },
      { syncCursor: poiSync.encodeCursor(99) },
      { syncCursor: poiSync.encodeCursor(1), syncMode: 'full' },
      { syncMode: 'delta' },
    ];
    for (const kwargs of cases) {
      const r = await t.load(kwargs);
      assert.equal(r.sync_mode, 'full', JSON.stringify(kwargs));
      assert.equal(r.pois.length, 1);
    }
  });

  it('updated_after delta', async () => {
    await t.createActive({ poi_id: 'poi-a' });
    await t.createActive({ poi_id: 'poi-b', coords: HUE });
    const longAgo = new Date('2000-01-01T00:00:00Z');
    const future = new Date(Date.now() + 3600 * 1000);

    let r = await t.load({ updatedAfter: longAgo });
    assert.deepEqual([r.sync_mode, r.pois.length], ['delta', 2]);
    r = await t.load({ updatedAfter: future });
    assert.deepEqual([r.sync_mode, r.pois], ['delta', []]);

    await svc.deletePoi(t.db, t.settings, 'poi-b');
    assert.deepEqual((await t.load({ updatedAfter: longAgo })).removed_poi_ids, ['poi-b']);
  });

  it('a re-created POI is not reported as removed', async () => {
    await t.createActive();
    const cursor = (await t.load()).sync_cursor;
    await svc.deletePoi(t.db, t.settings, 'hanoi-thang-long');
    await t.createActive();
    const r = await t.load({ syncCursor: cursor });
    assert.deepEqual(r.removed_poi_ids, []);
    assert.deepEqual(r.pois.map((p) => p.poi_id), ['hanoi-thang-long']);
  });

  it('the etag tracks the dataset version', async () => {
    await t.createActive();
    const etag = poiSync.makeEtag(await poiSync.getDatasetVersion(t.db), null);
    assert.equal(poiSync.etagMatches(etag, etag), true);
    await t.update('hanoi-thang-long', { priority: 9 });
    const next = poiSync.makeEtag(await poiSync.getDatasetVersion(t.db), null);
    assert.equal(poiSync.etagMatches(etag, next), false);
  });

  it('draft POIs are never served', async () => {
    await t.createActive({ poi_id: 'poi-a' });
    await t.create({ poi_id: 'poi-draft', coords: NEAR_HANOI });
    assert.deepEqual((await t.load()).pois.map((p) => p.poi_id), ['poi-a']);
    const found = await poiNearby.findNearby(t.db, { lat: HANOI[0], lng: HANOI[1], radiusM: 500, limit: 10, lang: null });
    assert.deepEqual(found.pois.map((p) => p.poi_id), ['poi-a']);
  });

  it('the client (FE) shape: camelCase, vi always present, absolute audio url', async () => {
    await t.createActive();
    const [poi] = await poiSync.loadClientPois(t.db, 'http://localhost:3000/');
    assert.equal(poi.id, 'hanoi-thang-long');
    assert.equal(poi.radiusMeters, 80);
    assert.equal(poi.name.vi, 'Thăng Long');
    assert.equal(poi.audio.en, 'http://localhost:3000/static/audio/hanoi-thang-long-en.mp3');
    assert.equal('poi_id' in poi, false);
  });
});

describe('nearby', () => {
  async function seedPois() {
    await t.createActive({ poi_id: 'poi-far', coords: HUE });
    await t.createActive({ poi_id: 'poi-near', coords: NEAR_HANOI });
    await t.createActive({ poi_id: 'poi-here', coords: HANOI });
  }
  const find = (extra = {}) => poiNearby.findNearby(t.db, {
    lat: HANOI[0], lng: HANOI[1], radiusM: 1000, limit: 10, lang: null, ...extra,
  });

  it('$geoNear path', async () => {
    await seedPois();
    const r = await find();
    assert.equal(r.source, 'geoNear');
    assert.deepEqual(r.pois.map((p) => p.poi_id), ['poi-here', 'poi-near']);
    const [here, near] = r.pois;
    assert.equal(here.distance_m, 0);
    assert.equal(here.inside_radius, true); // 0 m <= 80 m
    assert.equal(near.inside_radius, false); // ~84 m > 80 m
  });

  it('Haversine fallback matches $geoNear', async () => {
    await seedPois();
    const expected = (await find()).pois.map((p) => p.poi_id);
    t.db.geoUnavailable = true;
    const r = await find();
    assert.equal(r.source, 'haversine');
    assert.deepEqual(r.pois.map((p) => p.poi_id), expected);
  });

  it('radius, limit and language fallback', async () => {
    await seedPois();
    t.db.geoUnavailable = true;
    assert.equal((await find({ radiusM: 50 })).pois.length, 1);
    assert.equal((await find({ limit: 1 })).pois.length, 1);
    assert.equal((await find({ radiusM: 2_000_000 })).pois.length, 3);
    const content = (await find({ lang: 'ko' })).pois[0].content;
    assert.deepEqual([content.language_served, content.fallback], ['en', true]);
  });

  it('the fallback tie-break uses priority', async () => {
    await t.createActive({ poi_id: 'poi-low', coords: HANOI });
    await t.createActive({ poi_id: 'poi-high', coords: HANOI });
    await t.update('poi-high', { priority: 10 });
    t.db.geoUnavailable = true;
    assert.deepEqual((await find()).pois.map((p) => p.poi_id), ['poi-high', 'poi-low']);
  });
});
