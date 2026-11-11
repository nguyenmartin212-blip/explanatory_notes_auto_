// In-memory stand-in for the MongoDB driver (the subset the stores use), so the REAL stores and services run in
// tests without a MongoDB server. Supports: insertOne, find/findOne (+sort/limit/projection), updateOne/Many
// ($set, $setOnInsert, $inc, upsert), findOneAndUpdate, replaceOne, deleteOne/Many, countDocuments, createIndex
// (unique/sparse enforced) and aggregate([$geoNear, $limit, $project]).
import { haversineM } from '../../src/utils/geo.js';

const clone = (v) => structuredClone(v);
const isOp = (v) => v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$'));
const norm = (v) => (v instanceof Date ? v.getTime() : v);
const deepEq = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

function duplicateKeyError(message) {
  return Object.assign(new Error(`E11000 duplicate key error: ${message}`), { code: 11000 });
}

function matchField(value, cond) {
  if (!isOp(cond)) {
    if (Array.isArray(value) && !Array.isArray(cond)) return value.some((x) => deepEq(x, cond));
    return deepEq(value, cond);
  }
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in': return arg.some((x) => deepEq(value, x));
      case '$ne': return !deepEq(value, arg);
      case '$gt': return value != null && norm(value) > norm(arg);
      case '$gte': return value != null && norm(value) >= norm(arg);
      case '$lt': return value != null && norm(value) < norm(arg);
      case '$lte': return value != null && norm(value) <= norm(arg);
      case '$exists': return (value !== undefined) === Boolean(arg);
      case '$type': return arg === 'string' ? typeof value === 'string' : false;
      default: throw new Error(`FakeDb: unsupported operator ${op}`);
    }
  });
}

const matches = (doc, filter) => Object.entries(filter).every(([k, cond]) => matchField(doc[k], cond));

function project(doc, projection) {
  const out = clone(doc);
  if (!projection) return out;
  const keys = Object.keys(projection);
  const inclusive = keys.some((k) => k !== '_id' && projection[k]);
  if (inclusive) {
    const picked = {};
    for (const k of keys) if (k !== '_id' && projection[k] && k in out) picked[k] = out[k];
    if (projection._id !== 0 && '_id' in out) picked._id = out._id;
    return picked;
  }
  for (const k of keys) if (!projection[k]) delete out[k];
  return out;
}

function sortDocs(docs, spec) {
  if (!spec) return docs;
  const entries = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of entries) {
      const x = norm(a[k]);
      const y = norm(b[k]);
      if (x === y) continue;
      if (x === undefined || x === null) return -dir;
      if (y === undefined || y === null) return dir;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  });
}

function applyUpdate(doc, update, { inserting = false } = {}) {
  for (const [op, fields] of Object.entries(update)) {
    if (op === '$set') Object.assign(doc, clone(fields));
    else if (op === '$setOnInsert') { if (inserting) Object.assign(doc, clone(fields)); }
    else if (op === '$inc') for (const [k, n] of Object.entries(fields)) doc[k] = (doc[k] ?? 0) + n;
    else throw new Error(`FakeDb: unsupported update operator ${op}`);
  }
}

class Cursor {
  constructor(docs, projection) { this.docs = docs; this.projection = projection; this.limitN = null; }
  sort(spec) { this.docs = sortDocs(this.docs, spec); return this; }
  limit(n) { this.limitN = n; return this; }
  async toArray() {
    const list = this.limitN === null ? this.docs : this.docs.slice(0, this.limitN);
    return list.map((d) => project(d, this.projection));
  }
}

class FakeCollection {
  constructor(db, name) { this.db = db; this.name = name; this.docs = []; this.uniques = []; }

  async createIndex(spec, options = {}) {
    if (options.unique) this.uniques.push({ keys: Object.keys(spec), sparse: Boolean(options.sparse) });
    return 'idx';
  }

  checkUnique(candidate, ignore = null) {
    for (const { keys, sparse } of this.uniques) {
      if (sparse && keys.every((k) => candidate[k] === undefined)) continue;
      const clash = this.docs.find((d) => d !== ignore && keys.every((k) => deepEq(d[k], candidate[k])));
      if (clash) throw duplicateKeyError(`${this.name} ${keys.join('+')}`);
    }
  }

  async insertOne(doc) {
    const copy = clone(doc);
    if (copy._id === undefined) copy._id = ++this.db.idCounter;
    this.checkUnique(copy);
    this.docs.push(copy);
    return { acknowledged: true, insertedId: copy._id };
  }

  find(filter = {}, options = {}) {
    return new Cursor(this.docs.filter((d) => matches(d, filter)), options.projection);
  }

  async findOne(filter = {}, options = {}) {
    const doc = sortDocs(this.docs.filter((d) => matches(d, filter)), options.sort)[0];
    return doc ? project(doc, options.projection) : null;
  }

  upsertBase(filter) {
    const base = {};
    for (const [k, v] of Object.entries(filter)) if (!isOp(v)) base[k] = clone(v);
    return base;
  }

  async updateOne(filter, update, options = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (doc) {
      const next = clone(doc);
      applyUpdate(next, update);
      this.checkUnique(next, doc);
      Object.assign(doc, next);
      return { matchedCount: 1, modifiedCount: 1, upsertedId: null, upsertedCount: 0 };
    }
    if (options.upsert) {
      const fresh = this.upsertBase(filter);
      applyUpdate(fresh, update, { inserting: true });
      if (fresh._id === undefined) fresh._id = ++this.db.idCounter;
      this.checkUnique(fresh);
      this.docs.push(fresh);
      return { matchedCount: 0, modifiedCount: 0, upsertedId: fresh._id, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedId: null, upsertedCount: 0 };
  }

  async updateMany(filter, update) {
    const hit = this.docs.filter((d) => matches(d, filter));
    for (const doc of hit) applyUpdate(doc, update);
    return { matchedCount: hit.length, modifiedCount: hit.length };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    let doc = sortDocs(this.docs.filter((d) => matches(d, filter)), options.sort)[0];
    let inserting = false;
    if (!doc) {
      if (!options.upsert) return null;
      doc = this.upsertBase(filter);
      doc._id ??= ++this.db.idCounter;
      inserting = true;
    }
    const before = clone(doc);
    const next = clone(doc);
    applyUpdate(next, update, { inserting });
    this.checkUnique(next, inserting ? null : doc);
    if (inserting) this.docs.push(next);
    else Object.assign(doc, next);
    return project(options.returnDocument === 'after' ? next : before, options.projection);
  }

  async replaceOne(filter, replacement, options = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (doc) {
      const next = { ...clone(replacement), _id: doc._id };
      this.checkUnique(next, doc);
      for (const k of Object.keys(doc)) delete doc[k];
      Object.assign(doc, next);
      return { matchedCount: 1, modifiedCount: 1, upsertedId: null };
    }
    if (options.upsert) {
      const fresh = { ...clone(replacement), _id: ++this.db.idCounter };
      this.checkUnique(fresh);
      this.docs.push(fresh);
      return { matchedCount: 0, modifiedCount: 0, upsertedId: fresh._id };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
  }

  async deleteOne(filter) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  async deleteMany(filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  async countDocuments(filter = {}, options = {}) {
    const n = this.docs.filter((d) => matches(d, filter)).length;
    return options.limit ? Math.min(n, options.limit) : n;
  }

  aggregate(pipeline) {
    const run = async () => {
      if (this.db.geoUnavailable) throw new Error('$geoNear requires a 2dsphere index');
      let docs = this.docs.map(clone);
      for (const stage of pipeline) {
        if (stage.$geoNear) {
          const { near, distanceField, maxDistance, query } = stage.$geoNear;
          const [lng, lat] = near.coordinates;
          docs = docs
            .filter((d) => matches(d, query || {}))
            .map((d) => ({ ...d, [distanceField]: haversineM(lat, lng, d.location.coordinates[1], d.location.coordinates[0]) }))
            .filter((d) => d[distanceField] <= maxDistance)
            .sort((a, b) => a[distanceField] - b[distanceField]);
        } else if (stage.$limit) docs = docs.slice(0, stage.$limit);
        else if (stage.$project) docs = docs.map((d) => project(d, stage.$project));
        else throw new Error('FakeDb: unsupported pipeline stage');
      }
      return docs;
    };
    return { toArray: run };
  }
}

export class FakeDb {
  constructor() {
    this.collections = new Map();
    this.idCounter = 0;
    this.geoUnavailable = false; // simulate a missing 2dsphere index
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection(this, name));
    return this.collections.get(name);
  }
}
