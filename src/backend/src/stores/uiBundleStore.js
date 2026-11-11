// Store layer: only talks to the `ui_bundles` collection.
// Holds machine-translated UI bundles of long-tail locales (the 5 top-level languages are static files).
// One document per (namespace, locale): namespace, locale, source_hash, strings, updated_at
import { UI_BUNDLES } from '../db/collections.js';

export async function ensureIndexes(db) {
  await db.collection(UI_BUNDLES).createIndex({ namespace: 1, locale: 1 }, { unique: true });
}

export async function get(db, namespace, locale) {
  return db.collection(UI_BUNDLES).findOne({ namespace, locale }, { projection: { _id: 0 } });
}

export async function upsert(db, { namespace, locale, sourceHash, strings, now }) {
  await db.collection(UI_BUNDLES).replaceOne(
    { namespace, locale },
    { namespace, locale, source_hash: sourceHash, strings, updated_at: now },
    { upsert: true },
  );
}
