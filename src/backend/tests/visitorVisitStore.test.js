import test from 'node:test';
import assert from 'node:assert/strict';
import { VISITOR_VISITS } from '../src/db/collections.js';
import * as store from '../src/stores/visitorVisitStore.js';

function makeDb() {
  const docs = [];
  const indexes = [];
  const collection = {
    async createIndex(keys, options = {}) { indexes.push({ keys, options }); },
    async findOneAndUpdate(query, update, options = {}) {
      let doc = docs.find((item) => Object.entries(query).every(([k, v]) => item[k] === v));
      if (!doc && options.upsert) {
        doc = { ...update.$setOnInsert };
        docs.push(doc);
      } else if (doc && update.$set) Object.assign(doc, update.$set);
      if (doc && update.$unset) for (const key of Object.keys(update.$unset)) delete doc[key];
      return doc ? { ...doc } : null;
    },
    async findOne(query) { const doc = docs.find((item) => Object.entries(query).every(([k, v]) => item[k] === v)); return doc ? { ...doc } : null; },
    find(query, projection) {
      let rows = docs.filter((item) => Object.entries(query).every(([k, v]) => item[k] === v));
      return {
        sort(spec) { const [field, direction] = Object.entries(spec)[0]; rows = [...rows].sort((a, b) => (new Date(a[field]) - new Date(b[field])) * direction); return this; },
        skip(n) { rows = rows.slice(n); return this; },
        limit(n) { rows = rows.slice(0, n); return this; },
        async toArray() { return rows.map(({ _id, ...row }) => row); },
      };
    },
    async countDocuments(query) { return docs.filter((item) => Object.entries(query).every(([k, v]) => item[k] === v)).length; },
    async deleteOne(query) { const index = docs.findIndex((item) => Object.entries(query).every(([k, v]) => item[k] === v)); if (index < 0) return { deletedCount: 0 }; docs.splice(index, 1); return { deletedCount: 1 }; },
  };
  return { db: { collection(name) { assert.equal(name, VISITOR_VISITS); return collection; } }, docs, indexes };
}

test('creates indexes and 90-day retention', async () => {
  const { db, indexes } = makeDb();
  await store.ensureIndexes(db);
  assert.equal(indexes.length, 3);
  assert.equal(indexes.find((i) => i.options.name === 'visitor_visit_retention_ttl').options.expireAfterSeconds, 90 * 86400);
});

test('check-in is idempotent and check-out records method', async () => {
  const { db } = makeDb();
  const enteredAt = new Date('2026-01-01T00:00:00Z');
  const first = await store.checkIn(db, { visitId: 'visit-1', poiId: 'poi-a', at: enteredAt });
  const repeat = await store.checkIn(db, { visitId: 'visit-1', poiId: 'poi-b', at: new Date() });
  assert.equal(first.poi_id, 'poi-a');
  assert.equal(repeat.poi_id, 'poi-a');
  assert.equal(repeat.entered_at, enteredAt);
  const exited = await store.checkOut(db, { visitId: 'visit-1', at: new Date('2026-01-01T01:00:00Z'), exitMethod: 'geofence' });
  assert.equal(exited.status, 'exited');
  assert.equal(exited.exit_method, 'geofence');
});

test('itinerary save/clear and paginated listing work', async () => {
  const { db } = makeDb();
  await store.checkIn(db, { visitId: 'v1', poiId: 'poi-a', at: new Date('2026-01-01') });
  await store.checkIn(db, { visitId: 'v2', poiId: 'poi-a', at: new Date('2026-01-02') });
  const saved = await store.saveItinerary(db, { visitId: 'v1', poiIds: ['poi-a', 'poi-b'] });
  assert.deepEqual(saved.saved_itinerary.poi_ids, ['poi-a', 'poi-b']);
  const listed = await store.listVisits(db, { limit: 1, offset: 0, poiId: 'poi-a' });
  assert.equal(listed.total, 2);
  assert.equal(listed.items[0].visit_id, 'v2');
  const cleared = await store.clearItinerary(db, 'v1');
  assert.equal(cleared.saved_itinerary, undefined);
  assert.equal(await store.deleteByVisitId(db, 'v1'), true);
  assert.equal(await store.deleteByVisitId(db, 'v1'), false);
});
