// Store layer: only talks to the `roles` collection.
// Document shape: name, description, permissions (list, or ["*"] for super_admin),
// is_default, created_at, updated_at
import { ConflictError } from '../core/errors.js';
import { ROLES } from '../db/collections.js';
import { isDuplicateKey } from './util.js';

const NO_ID = { projection: { _id: 0 } };

export async function ensureIndexes(db) {
  await db.collection(ROLES).createIndex({ name: 1 }, { unique: true });
}

/** Insert roles that do not exist yet; never overwrite existing ones. */
export async function insertMissingRoles(db, roles) {
  const now = new Date();
  let created = 0;
  for (const role of roles) {
    const result = await db.collection(ROLES).updateOne(
      { name: role.name },
      { $setOnInsert: { ...role, permissions: [...role.permissions], created_at: now, updated_at: now } },
      { upsert: true },
    );
    if (result.upsertedId !== null && result.upsertedId !== undefined) created += 1;
  }
  return created;
}

export async function get(db, name) {
  return db.collection(ROLES).findOne({ name }, NO_ID);
}

export async function listAll(db) {
  return db.collection(ROLES).find({}, NO_ID).sort({ name: 1 }).toArray();
}

export async function create(db, doc) {
  const now = new Date();
  try {
    await db.collection(ROLES).insertOne({ ...doc, created_at: now, updated_at: now });
  } catch (err) {
    if (isDuplicateKey(err)) throw new ConflictError(`Role '${doc.name}' already exists`);
    throw err;
  }
}

export async function update(db, name, fields) {
  const result = await db.collection(ROLES).updateOne({ name }, { $set: { ...fields, updated_at: new Date() } });
  return result.matchedCount > 0;
}

export async function remove(db, name) {
  const result = await db.collection(ROLES).deleteOne({ name });
  return result.deletedCount > 0;
}
