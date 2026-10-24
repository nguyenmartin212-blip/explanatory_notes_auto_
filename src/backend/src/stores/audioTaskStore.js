// Store layer: only talks to the `audio_tasks` collection.
// One task document per (poi_id, language):
//   task_id, poi_id, language, text, source_lang, content_hash,
//   status: queued | running | paused | completed | failed | cancelled
//   stage, progress (0-100), error, attempts, rerun, cache_hit, result, audio_url,
//   created_at, queued_at, started_at, finished_at, updated_at
// `text` / `content_hash` are always the LATEST requested content. A worker holds a snapshot taken when it
// claimed the task; if the content changes meanwhile, `enqueue` sets `rerun` so the task is queued again
// when the worker finishes.
import crypto from 'node:crypto';
import { AUDIO_TASKS } from '../db/collections.js';

export const QUEUED = 'queued';
export const RUNNING = 'running';
export const PAUSED = 'paused';
export const COMPLETED = 'completed';
export const FAILED = 'failed';
export const CANCELLED = 'cancelled';

export const ALL_STATUSES = [QUEUED, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED];
export const TERMINAL_STATUSES = [COMPLETED, FAILED, CANCELLED];

const NO_ID = { projection: { _id: 0 } };
const newId = () => crypto.randomUUID().replaceAll('-', '');

export async function ensureIndexes(db) {
  const coll = db.collection(AUDIO_TASKS);
  await coll.createIndex({ status: 1, updated_at: 1 });
  await coll.createIndex({ status: 1, queued_at: 1 });
  await coll.createIndex({ poi_id: 1, language: 1 }, { unique: true });
  await coll.createIndex({ task_id: 1 }, { unique: true, sparse: true });
  await coll.createIndex({ updated_at: 1 });
}

/**
 * Queue audio generation for one language. Returns 'queued', 'rerun' or 'paused'.
 * - running: keep running, flag `rerun` (the worker's result for the old text is rejected by the
 *   content_hash check and the task is queued again).
 * - paused:  update the text but stay paused (an admin put it on hold).
 * - other:   (re)queue.
 */
export async function enqueue(db, { poiId, language, text, contentHash, sourceLang = null }) {
  const now = new Date();
  const coll = db.collection(AUDIO_TASKS);
  const base = {
    text,
    content_hash: contentHash,
    source_lang: sourceLang || language,
    updated_at: now,
  };
  const key = { poi_id: poiId, language };

  const running = await coll.updateOne({ ...key, status: RUNNING }, { $set: { ...base, rerun: true } });
  if (running.matchedCount) return 'rerun';
  const paused = await coll.updateOne({ ...key, status: PAUSED }, { $set: base });
  if (paused.matchedCount) return 'paused';

  await coll.updateOne(
    key,
    {
      $set: {
        ...base,
        status: QUEUED,
        queued_at: now,
        rerun: false,
        stage: null,
        progress: 0,
        error: null,
        cache_hit: null,
        result: null,
      },
      $setOnInsert: { task_id: newId(), created_at: now, attempts: 0 },
    },
    { upsert: true },
  );
  return 'queued';
}

export async function get(db, taskId) {
  return db.collection(AUDIO_TASKS).findOne({ task_id: taskId }, NO_ID);
}

/** Atomically take the oldest queued task and mark it running. */
export async function claimNext(db) {
  const now = new Date();
  return db.collection(AUDIO_TASKS).findOneAndUpdate(
    { status: QUEUED },
    {
      $set: { status: RUNNING, started_at: now, updated_at: now, stage: 'starting', progress: 0, error: null },
      $inc: { attempts: 1 },
    },
    { sort: { queued_at: 1, _id: 1 }, returnDocument: 'after', projection: { _id: 0 } },
  );
}

export async function setProgress(db, taskId, { stage, progress, extra = null }) {
  const result = await db.collection(AUDIO_TASKS).updateOne(
    { task_id: taskId, status: RUNNING },
    { $set: { stage, progress, updated_at: new Date(), ...(extra || {}) } },
  );
  return result.matchedCount > 0;
}

/**
 * Finish a running task. If its content changed while it ran (`rerun`), a completed/failed task goes back
 * to the queue instead of finishing.
 */
export async function finalize(db, taskId, { status, fields = null }) {
  const coll = db.collection(AUDIO_TASKS);
  const current = await coll.findOne({ task_id: taskId }, NO_ID);
  if (current === null) return null;
  const now = new Date();
  const update = { ...(fields || {}) };
  if (current.rerun && (status === COMPLETED || status === FAILED)) {
    Object.assign(update, { status: QUEUED, queued_at: now, progress: 0, stage: null, error: null });
  } else {
    update.status = status;
    if (TERMINAL_STATUSES.includes(status)) update.finished_at = now;
  }
  Object.assign(update, { rerun: false, updated_at: now });
  return coll.findOneAndUpdate(
    { task_id: taskId },
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
}

/**
 * Conditional status change (admin actions). Returns the new document, or null if the task was not in one
 * of `fromStatuses`.
 */
export async function transition(db, taskId, { fromStatuses, toStatus, fields = null }) {
  const now = new Date();
  const update = { status: toStatus, updated_at: now, ...(fields || {}) };
  if (toStatus === QUEUED) update.queued_at = now;
  if (TERMINAL_STATUSES.includes(toStatus)) update.finished_at = now;
  return db.collection(AUDIO_TASKS).findOneAndUpdate(
    { task_id: taskId, status: { $in: [...fromStatuses] } },
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
}

export async function listRecent(db, limit = 100) {
  return db.collection(AUDIO_TASKS).find({}, NO_ID).sort({ updated_at: -1 }).limit(limit).toArray();
}

export async function listUpdatedSince(db, since) {
  return db.collection(AUDIO_TASKS).find({ updated_at: { $gte: since } }, NO_ID).sort({ updated_at: 1 }).toArray();
}

export async function deleteForPoi(db, poiId) {
  const result = await db.collection(AUDIO_TASKS).deleteMany({ poi_id: poiId });
  return result.deletedCount;
}

/**
 * After a restart nothing is running in this process, so every 'running' task was interrupted and goes
 * back to the queue. Paused tasks stay paused.
 */
export async function requeueAllRunning(db) {
  const now = new Date();
  const result = await db.collection(AUDIO_TASKS).updateMany(
    { status: RUNNING },
    {
      $set: { status: QUEUED, queued_at: now, updated_at: now, recovered_at: now, stage: null, progress: 0 },
      $inc: { recovery_count: 1 },
    },
  );
  return result.modifiedCount;
}

/**
 * Requeue tasks stuck in 'running' longer than the lease time (progress updates refresh `updated_at`, so a
 * healthy long task is not requeued).
 */
export async function requeueStaleRunning(db, staleSeconds) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - staleSeconds * 1000);
  const result = await db.collection(AUDIO_TASKS).updateMany(
    { status: RUNNING, updated_at: { $lt: cutoff } },
    {
      $set: { status: QUEUED, queued_at: now, updated_at: now, recovered_at: now, stage: null, progress: 0 },
      $inc: { recovery_count: 1 },
    },
  );
  return result.modifiedCount;
}
