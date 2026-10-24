// GET /poi/load-all: full sync and delta sync.
// Version token: `dataset_version` (monotonic counter of public changes).
// ETag:          W/"<dataset_version>-<lang|all>"  (used with If-None-Match)
// sync_cursor:   opaque token holding the dataset_version the client is at.
// Delta sync is chosen when the client sends a usable `sync_cursor` (or `updated_after`) and `sync_mode` is
// not 'full'. Otherwise, or when the cursor is invalid or newer than the server (e.g. database reset), the
// answer is a full sync, and the response's `sync_mode` tells the client which one it got.
import { buildClientPoi, buildPoiPayload, iso } from './poiPayload.js';
import { poiDatasetStore, poiLocalizationStore, poiStore } from '../stores/index.js';

export const CURSOR_FORMAT = 1;

export function encodeCursor(version) {
  return Buffer.from(JSON.stringify({ c: CURSOR_FORMAT, v: version })).toString('base64url');
}

/** Return the dataset_version inside a cursor, or null if invalid. */
export function decodeCursor(token) {
  if (!token) return null;
  try {
    const data = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
    const version = data.v;
    if (data.c === CURSOR_FORMAT && Number.isInteger(version) && version >= 0) return version;
  } catch {
    /* invalid cursor */
  }
  return null;
}

export const makeEtag = (version, lang) => `W/"${version}-${lang || 'all'}"`;

function normalizeEtag(tag) {
  let t = tag.trim();
  if (t.startsWith('W/')) t = t.slice(2);
  return t.replace(/^"+|"+$/g, '');
}

export function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  const target = normalizeEtag(etag);
  return ifNoneMatch.split(',').some((raw) => {
    const part = raw.trim();
    return part === '*' || normalizeEtag(part) === target;
  });
}

export async function getDatasetVersion(db) {
  return poiDatasetStore.getVersion(db);
}

export async function loadAll(db, { lang = null, syncMode = 'auto', syncCursor = null, updatedAfter = null } = {}) {
  // Read the version BEFORE the data: anything changing in between is simply re-sent by the next delta.
  const version = await poiDatasetStore.getVersion(db);

  let cursorVersion = decodeCursor(syncCursor);
  if (cursorVersion !== null && cursorVersion > version) cursorVersion = null; // server was reset -> full sync

  let mode = 'full';
  if (syncMode !== 'full' && (cursorVersion !== null || updatedAfter !== null)) mode = 'delta';

  let pois;
  let removed = [];
  if (mode === 'full') {
    pois = await poiStore.listActive(db);
  } else if (cursorVersion !== null) {
    pois = await poiStore.listActiveSinceVersion(db, cursorVersion);
    removed = await poiDatasetStore.tombstoneIdsSinceVersion(db, cursorVersion);
  } else {
    pois = await poiStore.listActiveUpdatedAfter(db, updatedAfter);
    removed = await poiDatasetStore.tombstoneIdsDeletedAfter(db, updatedAfter);
  }

  pois.sort((a, b) => (a.poi_id < b.poi_id ? -1 : a.poi_id > b.poi_id ? 1 : 0));
  const locs = await poiLocalizationStore.listForPois(db, pois.map((p) => p.poi_id));
  const present = new Set(pois.map((p) => p.poi_id));

  return {
    dataset_version: version,
    sync_mode: mode,
    sync_cursor: encodeCursor(version),
    generated_at: iso(new Date()),
    count: pois.length,
    pois: pois.map((p) => buildPoiPayload(p, locs[p.poi_id] || {}, lang)),
    // An id that was deleted and re-created appears in `pois`, not as removed.
    removed_poi_ids: [...new Set(removed)].filter((id) => !present.has(id)).sort(),
  };
}

/** Public POIs in the FE `Poi` shape, ordered like the FE offline store: priority desc, id asc. */
export async function loadClientPois(db, baseUrl) {
  const pois = await poiStore.listActive(db);
  pois.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.poi_id < b.poi_id ? -1 : a.poi_id > b.poi_id ? 1 : 0));
  const locs = await poiLocalizationStore.listForPois(db, pois.map((p) => p.poi_id));
  return pois.map((p) => buildClientPoi(p, locs[p.poi_id] || {}, baseUrl));
}
