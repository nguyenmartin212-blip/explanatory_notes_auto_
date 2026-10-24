// Store layer: only talks to the `poi_localizations` collection.
// One document per (poi_id, language):
//   poi_id, language, name, description, tts_script, content_hash,
//   audio_status ("none" | "pending" | "ready" | "failed"),
//   audio_url, audio_path, audio_hash, audio_error, updated_at
import { POI_LOCALIZATIONS } from '../db/collections.js';

const NO_ID = { projection: { _id: 0 } };

export async function ensureIndexes(db) {
  await db.collection(POI_LOCALIZATIONS).createIndex({ poi_id: 1, language: 1 }, { unique: true });
}

export async function get(db, poiId, language) {
  return db.collection(POI_LOCALIZATIONS).findOne({ poi_id: poiId, language }, NO_ID);
}

/** -> { [language]: doc } */
export async function listForPoi(db, poiId) {
  const docs = await db.collection(POI_LOCALIZATIONS).find({ poi_id: poiId }, NO_ID).toArray();
  return Object.fromEntries(docs.map((d) => [d.language, d]));
}

/** -> { [poi_id]: { [language]: doc } } */
export async function listForPois(db, poiIds) {
  if (!poiIds.length) return {};
  const docs = await db.collection(POI_LOCALIZATIONS).find({ poi_id: { $in: poiIds } }, NO_ID).toArray();
  const result = {};
  for (const doc of docs) (result[doc.poi_id] ??= {})[doc.language] = doc;
  return result;
}

export async function upsert(db, doc) {
  await db.collection(POI_LOCALIZATIONS).replaceOne(
    { poi_id: doc.poi_id, language: doc.language }, doc, { upsert: true },
  );
}

/** Only succeeds if the text was not changed since the audio was requested. */
export async function markAudioReady(db, {
  poiId, language, contentHash, audioPath, audioUrl, now, audioSha256 = null, audioSize = null,
}) {
  const result = await db.collection(POI_LOCALIZATIONS).updateOne(
    { poi_id: poiId, language, content_hash: contentHash },
    {
      $set: {
        audio_status: 'ready',
        audio_url: audioUrl,
        audio_path: audioPath,
        audio_hash: contentHash,
        audio_sha256: audioSha256,
        audio_size: audioSize,
        audio_error: null,
        updated_at: now,
      },
    },
  );
  return result.matchedCount > 0;
}

/** Failed -> pending when an admin retries the audio task. */
export async function markAudioPending(db, { poiId, language, contentHash, now }) {
  const result = await db.collection(POI_LOCALIZATIONS).updateOne(
    { poi_id: poiId, language, content_hash: contentHash, audio_status: 'failed' },
    { $set: { audio_status: 'pending', audio_error: null, updated_at: now } },
  );
  return result.matchedCount > 0;
}

export async function markAudioFailed(db, { poiId, language, contentHash, error, now }) {
  const result = await db.collection(POI_LOCALIZATIONS).updateOne(
    { poi_id: poiId, language, content_hash: contentHash },
    { $set: { audio_status: 'failed', audio_error: error, updated_at: now } },
  );
  return result.matchedCount > 0;
}

export async function deleteForPoi(db, poiId) {
  const result = await db.collection(POI_LOCALIZATIONS).deleteMany({ poi_id: poiId });
  return result.deletedCount;
}
