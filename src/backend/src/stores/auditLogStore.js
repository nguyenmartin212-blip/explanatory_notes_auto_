// Store layer: only talks to the `audit_logs` collection (append-only).
import { AUDIT_LOGS } from '../db/collections.js';

export async function ensureIndexes(db) {
  await db.collection(AUDIT_LOGS).createIndex({ created_at: -1 });
  await db.collection(AUDIT_LOGS).createIndex({ action: 1, created_at: -1 });
  await db.collection(AUDIT_LOGS).createIndex({ target_id: 1 }, { sparse: true });
}

/** Never put secrets (passwords, tokens) in `details`. */
export async function insert(db, { action, actorId, targetId, details, at }) {
  await db.collection(AUDIT_LOGS).insertOne({
    action,
    actor_id: actorId,
    target_id: targetId ?? null,
    details: details || {},
    created_at: at,
  });
}
