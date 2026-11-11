// Store layer: dataset version counter (`dataset_meta`) and tombstones (`poi_tombstones`).
// `dataset_version` is a monotonic counter bumped on every change that clients can see. Each public POI
// is stamped with the version of its last change, and each deleted POI leaves a tombstone stamped the
// same way, so a client holding version N can ask for "everything after N".
import { DATASET_META, POI_TOMBSTONES } from '../db/collections.js';

export const POI_DATASET_ID = 'poi_dataset';

export async function ensureIndexes(db) {
  await db.collection(POI_TOMBSTONES).createIndex({ poi_id: 1 }, { unique: true });
  await db.collection(POI_TOMBSTONES).createIndex({ dataset_version: 1 });
  await db.collection(POI_TOMBSTONES).createIndex({ deleted_at: 1 });
}

export async function getVersion(db) {
  const doc = await db.collection(DATASET_META).findOne({ _id: POI_DATASET_ID });
  return doc ? Number(doc.version) : 0;
}

export async function bumpVersion(db) {
  const doc = await db.collection(DATASET_META).findOneAndUpdate(
    { _id: POI_DATASET_ID },
    { $inc: { version: 1 }, $set: { updated_at: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  return Number(doc.version);
}

export async function addTombstone(db, poiId, version, deletedAt) {
  await db.collection(POI_TOMBSTONES).replaceOne(
    { poi_id: poiId },
    { poi_id: poiId, dataset_version: version, deleted_at: deletedAt },
    { upsert: true },
  );
}

export async function removeTombstone(db, poiId) {
  await db.collection(POI_TOMBSTONES).deleteOne({ poi_id: poiId });
}

export async function tombstoneIdsSinceVersion(db, version) {
  const docs = await db.collection(POI_TOMBSTONES)
    .find({ dataset_version: { $gt: version } }, { projection: { _id: 0, poi_id: 1 } }).toArray();
  return docs.map((d) => d.poi_id);
}

export async function tombstoneIdsDeletedAfter(db, after) {
  const docs = await db.collection(POI_TOMBSTONES)
    .find({ deleted_at: { $gt: after } }, { projection: { _id: 0, poi_id: 1 } }).toArray();
  return docs.map((d) => d.poi_id);
}
