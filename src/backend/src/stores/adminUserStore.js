// Store layer: only talks to the `admin_users` collection (all account types).
// Document shape:
//   user_id, username (lower case), email, password_hash, role, is_active,
//   token_version (bumped to invalidate every token of the user),
//   created_at, updated_at, last_login_at
import crypto from 'node:crypto';
import { ConflictError } from '../core/errors.js';
import { ADMIN_USERS } from '../db/collections.js';
import { isDuplicateKey } from './util.js';

const NO_ID = { projection: { _id: 0 } };
const newId = () => crypto.randomUUID().replaceAll('-', '');

export async function ensureIndexes(db) {
  const coll = db.collection(ADMIN_USERS);
  await coll.createIndex({ username: 1 }, { unique: true });
  await coll.createIndex({ user_id: 1 }, { unique: true, sparse: true });
  await coll.createIndex({ role: 1 });
}

/** Accounts created before Chapter 07 have no user_id / token_version. */
export async function backfillUserIds(db) {
  let count = 0;
  const docs = await db.collection(ADMIN_USERS).find({ user_id: { $exists: false } }, { projection: { _id: 1 } }).toArray();
  for (const doc of docs) {
    await db.collection(ADMIN_USERS).updateOne(
      { _id: doc._id, user_id: { $exists: false } },
      { $set: { user_id: newId(), token_version: 0 } },
    );
    count += 1;
  }
  return count;
}

export async function existsWithRole(db, role) {
  return (await db.collection(ADMIN_USERS).countDocuments({ role }, { limit: 1 })) > 0;
}

export async function countWithRole(db, role) {
  return db.collection(ADMIN_USERS).countDocuments({ role });
}

export async function createUser(db, { username, passwordHash, role, email = null }) {
  const now = new Date();
  const doc = {
    user_id: newId(),
    username: username.trim().toLowerCase(),
    email,
    password_hash: passwordHash,
    role,
    is_active: true,
    token_version: 0,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection(ADMIN_USERS).insertOne({ ...doc });
  } catch (err) {
    if (isDuplicateKey(err)) throw new ConflictError(`Username '${doc.username}' already exists`);
    throw err;
  }
  return doc;
}

export async function getById(db, userId) {
  return db.collection(ADMIN_USERS).findOne({ user_id: userId }, NO_ID);
}

export async function getByUsername(db, username) {
  return db.collection(ADMIN_USERS).findOne({ username: username.trim().toLowerCase() }, NO_ID);
}

export async function updateFields(db, userId, fields) {
  const result = await db.collection(ADMIN_USERS).updateOne(
    { user_id: userId },
    { $set: { ...fields, updated_at: fields.updated_at ?? new Date() } },
  );
  return result.matchedCount > 0;
}

export async function recordLogin(db, userId, now) {
  await db.collection(ADMIN_USERS).updateOne({ user_id: userId }, { $set: { last_login_at: now } });
}

export async function bumpTokenVersion(db, userId) {
  const doc = await db.collection(ADMIN_USERS).findOneAndUpdate(
    { user_id: userId },
    { $inc: { token_version: 1 }, $set: { updated_at: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  return doc ? Number(doc.token_version) : null;
}

export async function setRole(db, userId, role) {
  return updateFields(db, userId, { role });
}

/**
 * List accounts for the admin dashboard.
 * Never return password_hash or token_version.
 */
export async function listUsers(db, { limit = 50, offset = 0 } = {}) {
  const coll = db.collection(ADMIN_USERS);

  const [items, total] = await Promise.all([
    coll.find(
      {},
      {
        projection: {
          _id: 0,
          user_id: 1,
          username: 1,
          email: 1,
          role: 1,
          is_active: 1,
          created_at: 1,
          updated_at: 1,
          last_login_at: 1,
        },
      },
    )
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),

    coll.countDocuments({}),
  ]);

  return { items, total };
}