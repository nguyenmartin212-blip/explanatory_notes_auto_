// Paths: /poi/load-all, /poi/nearby (Chapter 05) and /pois (the path the FE calls: src/features/poi/api.ts)
import { Router } from 'express';
import {
  baseUrlOf, header, queryDatetime, queryEnum, queryNumber, settingsOf, stateOf, wrap,
} from '../core/http.js';
import { SUPPORTED_LANGUAGES } from '../schemas/content.js';
import * as poiNearby from '../services/poiNearby.js';
import * as poiSync from '../services/poiSync.js';

export const router = Router();

const SYNC_MODES = ['auto', 'full', 'delta'];

/** All public POIs. Full sync, or delta sync when a cursor / updated_after is sent. */
router.get('/poi/load-all', wrap(async (req, res) => {
  const lang = queryEnum(req, 'lang', SUPPORTED_LANGUAGES); // adds `content` resolved with fallback lang -> en -> vi
  const syncMode = queryEnum(req, 'sync_mode', SYNC_MODES, { def: 'auto' });
  const syncCursor = typeof req.query.sync_cursor === 'string' ? req.query.sync_cursor : null;
  const updatedAfter = queryDatetime(req, 'updated_after');
  const { db } = stateOf(req);

  const version = await poiSync.getDatasetVersion(db);
  let etag = poiSync.makeEtag(version, lang);
  if (poiSync.etagMatches(header(req, 'if-none-match'), etag)) {
    return res.status(304).set({ ETag: etag, 'Cache-Control': 'no-cache' }).end();
  }
  const payload = await poiSync.loadAll(db, { lang, syncMode, syncCursor, updatedAfter });
  etag = poiSync.makeEtag(payload.dataset_version, lang);
  return res.set({ ETag: etag, 'Cache-Control': 'no-cache' }).json(payload);
}));

/** Public POIs around a point, nearest first. */
router.get('/poi/nearby', wrap(async (req, res) => {
  const lat = queryNumber(req, 'lat', { min: -90, max: 90, required: true });
  const lng = queryNumber(req, 'lng', { min: -180, max: 180, required: true });
  const radius = queryNumber(req, 'radius', { def: 1000, min: 1, max: 50000, integer: true }); // meters
  const limit = queryNumber(req, 'limit', { def: 20, min: 1, max: 100, integer: true });
  const lang = queryEnum(req, 'lang', SUPPORTED_LANGUAGES);
  res.json(await poiNearby.findNearby(stateOf(req).db, { lat, lng, radiusM: radius, limit, lang }));
}));

/** Public POIs as the FE `Poi[]` (camelCase, localized maps, absolute audio URLs). */
router.get('/pois', wrap(async (req, res) => {
  const { db } = stateOf(req);
  const version = await poiSync.getDatasetVersion(db);
  const etag = poiSync.makeEtag(version, 'fe');
  res.set({ ETag: etag, 'Cache-Control': 'no-cache' });
  if (poiSync.etagMatches(header(req, 'if-none-match'), etag)) return res.status(304).end();
  const payload = await poiSync.loadClientPois(db, baseUrlOf(req, settingsOf(req)));
  return res.json(payload);
}));
