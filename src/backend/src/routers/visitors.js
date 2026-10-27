// Anonymous visitor sessions for recording arrivals and departures at a point of interest.
import { Router } from 'express';
import { HttpError, ValidationError } from '../core/errors.js';
import { stateOf, wrap } from '../core/http.js';
import * as visitorVisitStore from '../stores/visitorVisitStore.js';

export const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POI_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,80}$/;
const EXIT_METHODS = new Set(['manual', 'geofence']);

function fail(field, message) {
  throw new ValidationError([{ loc: ['body', field], msg: message }]);
}
function bodyOf(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ValidationError([{ loc: ['body'], msg: 'Input should be a valid object' }]);
  }
  return req.body;
}
function uuid(value, field = 'visit_id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(field, 'Input should be a valid UUID');
  return value.toLowerCase();
}
function poiId(value, field = 'poi_id') {
  if (typeof value !== 'string' || !POI_RE.test(value)) fail(field, "String should match pattern '^[A-Za-z0-9][A-Za-z0-9-]{1,80}$'");
  return value;
}
function publicVisit(visit) {
  if (!visit) return null;
  return {
    visit_id: visit.visit_id,
    poi_id: visit.poi_id,
    status: visit.status,
    entered_at: visit.entered_at,
    exited_at: visit.exited_at ?? null,
    exit_method: visit.exit_method ?? null,
    saved_itinerary: visit.saved_itinerary ?? null,
  };
}

router.post('/check-in', wrap(async (req, res) => {
  const body = bodyOf(req);
  const visit = await visitorVisitStore.checkIn(stateOf(req).db, {
    visitId: uuid(body.visit_id),
    poiId: poiId(body.poi_id),
    at: new Date(),
  });
  res.json(publicVisit(visit));
}));

router.post('/check-out', wrap(async (req, res) => {
  const body = bodyOf(req);
  const visitId = uuid(body.visit_id);
  const exitMethod = body.exit_method === undefined ? 'manual' : body.exit_method;
  if (!EXIT_METHODS.has(exitMethod)) fail('exit_method', "Input should be 'manual' or 'geofence'");
  const db = stateOf(req).db;
  let visit = await visitorVisitStore.checkOut(db, { visitId, at: new Date(), exitMethod });
  if (!visit) visit = await visitorVisitStore.getByVisitId(db, visitId);
  if (!visit) throw new HttpError(404, 'Visit session not found');
  res.json(publicVisit(visit));
}));

router.post('/itinerary', wrap(async (req, res) => {
  const body = bodyOf(req);
  const visitId = uuid(body.visit_id);
  if (!Array.isArray(body.poi_ids) || body.poi_ids.length < 1 || body.poi_ids.length > 20) {
    fail('poi_ids', 'List should contain between 1 and 20 items');
  }
  const poiIds = body.poi_ids.map((id, index) => poiId(id, `poi_ids.${index}`));
  if (new Set(poiIds).size !== poiIds.length) fail('poi_ids', 'A saved itinerary cannot contain duplicate locations');
  const visit = await visitorVisitStore.saveItinerary(stateOf(req).db, { visitId, poiIds, at: new Date() });
  if (!visit) throw new HttpError(404, 'Visit session not found');
  res.json(publicVisit(visit));
}));

router.delete('/itinerary/:visit_id', wrap(async (req, res) => {
  const visitId = uuid(req.params.visit_id);
  const visit = await visitorVisitStore.clearItinerary(stateOf(req).db, visitId);
  if (!visit) throw new HttpError(404, 'Visit session not found');
  res.json(publicVisit(visit));
}));

router.delete('/:visit_id', wrap(async (req, res) => {
  const visitId = uuid(req.params.visit_id);
  const deleted = await visitorVisitStore.deleteByVisitId(stateOf(req).db, visitId);
  if (!deleted) throw new HttpError(404, 'Visit session not found');
  res.json({ deleted: true });
}));
