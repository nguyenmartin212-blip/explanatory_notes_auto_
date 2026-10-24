// Store layer: only talks to the `POI` collection.
// Document shape:
//   poi_id, status ("draft" | "active"), location (GeoJSON Point, [lng, lat]),
//   radius_meters, priority, images, map_url, dataset_version (set when public),
//   created_at, updated_at, activated_at
import { ConflictError, GeoQueryUnavailable } from '../core/errors.js';
import { POI } from '../db/collections.js';
import { isDuplicateKey } from './util.js';

export const STATUS_DRAFT = 'draft';
export const STATUS_ACTIVE = 'active';
const NO_ID = { projection: { _id: 0 } };

export async function ensureIndexes(db) {
  await db.collection(POI).createIndex({ poi_id: 1 }, { unique: true });
  await db.collection(POI).createIndex({ location: '2dsphere' });
  await db.collection(POI).createIndex({ status: 1, dataset_version: 1 });
  await db.collection(POI).createIndex({ status: 1, updated_at: 1 });
}

export async function insert(db, doc) {
  try {
    await db.collection(POI).insertOne({ ...doc });
  } catch (err) {
    if (isDuplicateKey(err)) throw new ConflictError(`POI '${doc.poi_id}' already exists`);
    throw err;
  }
}

export async function get(db, poiId) {
  return db.collection(POI).findOne({ poi_id: poiId }, NO_ID);
}

export async function updateFields(db, poiId, fields) {
  const result = await db.collection(POI).updateOne({ poi_id: poiId }, { $set: fields });
  return result.matchedCount > 0;
}

export async function remove(db, poiId) {
  const result = await db.collection(POI).deleteOne({ poi_id: poiId });
  return result.deletedCount > 0;
}

export async function listActive(db) {
  return db.collection(POI).find({ status: STATUS_ACTIVE }, NO_ID).toArray();
}

export async function listActiveSinceVersion(db, version) {
  return db.collection(POI).find({ status: STATUS_ACTIVE, dataset_version: { $gt: version } }, NO_ID).toArray();
}

export async function listActiveUpdatedAfter(db, after) {
  return db.collection(POI).find({ status: STATUS_ACTIVE, updated_at: { $gt: after } }, NO_ID).toArray();
}

/**
 * Active POIs within `maxDistanceM`, nearest first, via $geoNear.
 * Throws GeoQueryUnavailable if MongoDB cannot run the query (the caller then falls back to Haversine).
 * -> [[poi, distance_m], ...]
 */
export async function geoNear(db, { lat, lng, maxDistanceM, limit }) {
  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance_m',
        maxDistance: Number(maxDistanceM),
        spherical: true,
        query: { status: STATUS_ACTIVE },
      },
    },
    { $limit: limit },
    { $project: { _id: 0 } },
  ];
  let docs;
  try {
    docs = await db.collection(POI).aggregate(pipeline).toArray();
  } catch (err) {
    throw new GeoQueryUnavailable(err.message);
  }
  return docs.map((doc) => {
    const { distance_m: distance, ...rest } = doc;
    return [rest, Number(distance)];
  });
}
