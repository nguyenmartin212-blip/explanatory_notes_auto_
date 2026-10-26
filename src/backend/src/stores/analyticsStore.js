// Store layer for device presence and usage sessions.
import { DEVICE_PRESENCE, DEVICE_USAGE_SESSIONS } from '../db/collections.js';

export async function ensureIndexes(db) {
  await db.collection(DEVICE_PRESENCE).createIndex({ user_id: 1, device_id: 1 }, { unique: true });
  await db.collection(DEVICE_PRESENCE).createIndex({ last_seen_at: -1 });
  await db.collection(DEVICE_USAGE_SESSIONS).createIndex({ started_at: -1 });
  await db.collection(DEVICE_USAGE_SESSIONS).createIndex({ user_id: 1, device_id: 1, started_at: -1 });
}

export async function getPresence(db, userId, deviceId) {
  return db.collection(DEVICE_PRESENCE).findOne({ user_id: userId, device_id: deviceId });
}

export async function savePresence(db, { userId, deviceId, deviceName, now }) {
  await db.collection(DEVICE_PRESENCE).updateOne(
    { user_id: userId, device_id: deviceId },
    { $set: { user_id: userId, device_id: deviceId, device_name: deviceName, last_seen_at: now } },
    { upsert: true },
  );
}

export async function recordSession(db, { userId, deviceId, deviceName, startedAt }) {
  await db.collection(DEVICE_USAGE_SESSIONS).insertOne({
    user_id: userId,
    device_id: deviceId,
    device_name: deviceName,
    started_at: startedAt,
  });
}

export async function listActiveDevices(db, cutoff) {
  return db.collection(DEVICE_PRESENCE)
    .find({ last_seen_at: { $gte: cutoff } }, { projection: { _id: 0, user_id: 1, device_id: 1, device_name: 1, last_seen_at: 1 } })
    .sort({ last_seen_at: -1 })
    .toArray();
}

/** Return counts by UTC calendar day/month; grouping in JS also keeps the store testable with the project FakeDb. */
export async function countSessions(db, from, to, period) {
  const sessions = await db.collection(DEVICE_USAGE_SESSIONS)
    .find({ started_at: { $gte: from, $lt: to } }, { projection: { _id: 0, user_id: 1, device_id: 1, started_at: 1 } })
    .toArray();
  const groups = new Map();
  for (const session of sessions) {
    if (!(session.started_at instanceof Date)) continue;
    const date = session.started_at;
    const key = period === 'month'
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
      : date.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, { period: key, sessions: 0, unique: new Set() });
    const group = groups.get(key);
    group.sessions += 1;
    group.unique.add(`${session.user_id}\u0000${session.device_id}`);
  }
  return [...groups.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(({ period: key, sessions: count, unique }) => ({ period: key, sessions: count, uniqueDevices: unique.size }));
}
