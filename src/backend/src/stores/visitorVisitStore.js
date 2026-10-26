// Store layer for anonymous visitor check-in sessions.
import { VISITOR_VISITS } from '../db/collections.js';

export const VISIT_RETENTION_DAYS = 90;
const WITHOUT_ID = { projection: { _id: 0 } };

export async function ensureIndexes(db) {
  const visits = db.collection(VISITOR_VISITS);
  await visits.createIndex({ visit_id: 1 }, { unique: true });
  await visits.createIndex({ poi_id: 1, entered_at: -1 });
  await visits.createIndex(
    { entered_at: 1 },
    { expireAfterSeconds: VISIT_RETENTION_DAYS * 24 * 60 * 60, name: 'visitor_visit_retention_ttl' },
  );
}

/** Create a visit once; repeating the same visit_id does not reset its original POI or entry time. */
export async function checkIn(db, { visitId, poiId, at = new Date() }) {
  return db.collection(VISITOR_VISITS).findOneAndUpdate(
    { visit_id: visitId },
    { $setOnInsert: { visit_id: visitId, poi_id: poiId, entered_at: at, status: 'inside' } },
    { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
  );
}

export async function checkOut(db, { visitId, at = new Date(), exitMethod = 'manual' }) {
  return db.collection(VISITOR_VISITS).findOneAndUpdate(
    { visit_id: visitId, status: 'inside' },
    { $set: { status: 'exited', exited_at: at, exit_method: exitMethod } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
}

export async function getByVisitId(db, visitId) {
  return db.collection(VISITOR_VISITS).findOne({ visit_id: visitId }, WITHOUT_ID);
}

export async function listVisits(db, { limit = 50, offset = 0, poiId = null } = {}) {
  const query = poiId ? { poi_id: poiId } : {};
  const [items, total] = await Promise.all([
    db.collection(VISITOR_VISITS).find(query, WITHOUT_ID)
      .sort({ entered_at: -1 }).skip(offset).limit(limit).toArray(),
    db.collection(VISITOR_VISITS).countDocuments(query),
  ]);
  return { items, total };
}

export async function saveItinerary(db, { visitId, poiIds, at = new Date() }) {
  return db.collection(VISITOR_VISITS).findOneAndUpdate(
    { visit_id: visitId },
    { $set: { saved_itinerary: { poi_ids: poiIds, saved_at: at } } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
}

export async function clearItinerary(db, visitId) {
  return db.collection(VISITOR_VISITS).findOneAndUpdate(
    { visit_id: visitId },
    { $unset: { saved_itinerary: '' } },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
}

export async function deleteByVisitId(db, visitId) {
  const result = await db.collection(VISITOR_VISITS).deleteOne({ visit_id: visitId });
  return result.deletedCount === 1;
}
