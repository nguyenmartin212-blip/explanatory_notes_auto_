// scripts/seed-pois.js: the 3 FE demo POIs, idempotent upsert.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { DEMO_POIS, seed } from '../scripts/seed-pois.js';
import * as poiSync from '../src/services/poiSync.js';
import { makeWorld } from './helpers/world.js';

let w;
beforeEach(async () => { w = await makeWorld().init(); });
afterEach(() => w.cleanup());

describe('seed demo POIs', () => {
  it('has the 3 FE demo POIs with the FE radii', () => {
    assert.deepEqual(DEMO_POIS.map((p) => [p.poi_id, p.radius_meters]), [
      ['hanoi-thang-long', 80], ['hue-imperial-city', 120], ['saigon-ben-thanh', 90],
    ]);
  });

  it('creates and activates them (forced: the demo data has no audio)', async () => {
    const result = await seed(w.db, w.settings);
    assert.deepEqual(Object.values(result), ['created', 'created', 'created']);
    assert.equal(w.pois().length, 3);
    assert.ok(w.pois().every((p) => p.status === 'active'));
    const sync = await poiSync.loadAll(w.db, {});
    assert.equal(sync.count, 3);
    const client = await poiSync.loadClientPois(w.db, 'http://localhost:3000/');
    assert.deepEqual(client.map((p) => p.id).sort(), ['hanoi-thang-long', 'hue-imperial-city', 'saigon-ben-thanh']);
    assert.ok(client.every((p) => p.name.vi && p.description.vi));
  });

  it('can be run many times without duplicates or a new dataset_version', async () => {
    await seed(w.db, w.settings);
    const version = w.version();
    const locs = w.locs().length;
    const tasks = w.tasks().length;
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(Object.values(await seed(w.db, w.settings)), ['updated', 'updated', 'updated']);
    }
    assert.equal(w.pois().length, 3);
    assert.equal(w.locs().length, locs);
    assert.equal(w.tasks().length, tasks);
    assert.equal(w.version(), version);
  });

  it('--draft keeps them private', async () => {
    await seed(w.db, w.settings, { activate: false });
    assert.ok(w.pois().every((p) => p.status === 'draft'));
    assert.equal((await poiSync.loadAll(w.db, {})).count, 0);
  });
});
