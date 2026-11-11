// POI lifecycle: create -> update -> activate -> (served by sync/nearby) -> delete.
// Rules (Chapter 05):
// - `POI` holds the source data, `poi_localizations` the per-language content.
// - A POI starts as 'draft' and is public ('active') only after activation, which requires English content
//   and English audio to be ready.
// - When the text an audio was generated from changes, the old audio is dropped (file deleted), the
//   language goes back to 'pending' and a new audio task is queued.
// - Every change visible to clients bumps `dataset_version`; deleting a public POI also leaves a tombstone
//   so delta sync can report it in `removed_poi_ids`.
// Router -> service -> store: this module never touches a database driver directly.
import crypto from 'node:crypto';
import { NotFoundError, NotReadyError } from '../core/errors.js';
import { computeContentHash, hasValidAudio, isUsable, narrationText } from './localizationFallback.js';
import { deleteMedia } from './mediaStorage.js';
import { iso, poiCoordinates } from './poiPayload.js';
import {
  audioTaskStore, poiDatasetStore, poiLocalizationStore, poiStore,
} from '../stores/index.js';

export const REQUIRED_LANGUAGE = 'en';
const AUDIO_KEYS = ['audio_status', 'audio_url', 'audio_path', 'audio_hash', 'audio_sha256', 'audio_size', 'audio_error'];

async function deleteFile(settings, key) {
  if (key) await deleteMedia(settings, key);
}

// ---- Readiness -----------------------------------------------------------------------------------
/** A POI may be activated only with usable English content and ready English audio. */
export function evaluateReadiness(english) {
  const missing = [];
  if (!isUsable(english)) missing.push('en_content');
  else if (!hasValidAudio(english)) missing.push('en_audio');
  return { ready: missing.length === 0, missing };
}

export async function checkReadiness(db, poiId) {
  return evaluateReadiness(await poiLocalizationStore.get(db, poiId, REQUIRED_LANGUAGE));
}

// ---- Helpers -------------------------------------------------------------------------------------
/** Make a change of an active POI visible to clients (bump + stamp). */
async function publishChange(db, poiId) {
  const version = await poiDatasetStore.bumpVersion(db);
  await poiStore.updateFields(db, poiId, { dataset_version: version, updated_at: new Date() });
  return version;
}

/** Create/replace one language. Returns true if anything changed. */
async function saveLocalizationDoc(db, settings, poiId, language, data, existing, extra = null) {
  const now = new Date();
  const text = narrationText({ tts_script: data.tts_script, description: data.description });
  const newHash = computeContentHash(language, text);

  const doc = {
    poi_id: poiId,
    language,
    name: data.name,
    description: data.description,
    tts_script: data.tts_script ?? null,
    content_hash: newHash,
    updated_at: now,
    ...(extra || {}),
  };

  const sameText = Boolean(existing) && existing.content_hash === newHash;
  let oldAudioPath = null;
  let needAudio;
  if (sameText) {
    // Narration text unchanged: keep the audio (and its state) as it is.
    for (const key of AUDIO_KEYS) doc[key] = existing[key] ?? null;
    const retry = (existing.audio_status === undefined || existing.audio_status === null || existing.audio_status === 'failed') && Boolean(text);
    if (retry) {
      doc.audio_status = 'pending';
      doc.audio_error = null;
    }
    needAudio = retry;
  } else {
    oldAudioPath = existing?.audio_path ?? null;
    Object.assign(doc, {
      audio_status: text ? 'pending' : 'none',
      audio_url: null,
      audio_path: null,
      audio_hash: null,
      audio_sha256: null,
      audio_size: null,
      audio_error: null,
    });
    needAudio = Boolean(text);
  }

  const changed = !existing
    || ['name', 'description', 'tts_script'].some((k) => (existing[k] ?? null) !== (doc[k] ?? null))
    || !sameText;

  await poiLocalizationStore.upsert(db, doc);
  await deleteFile(settings, oldAudioPath);
  if (needAudio) {
    await audioTaskStore.enqueue(db, { poiId, language, text, contentHash: newHash });
  }
  return changed;
}

/**
 * Create/replace one language of an existing POI (used by automatic translation). `extra` holds additional
 * fields stored with the localization. If the POI is public the change is published (dataset_version bump).
 * Returns true if changed.
 */
export async function saveLocalization(db, settings, poiId, language, data, extra = null) {
  const poi = await poiStore.get(db, poiId);
  if (!poi) throw new NotFoundError(`POI '${poiId}' not found`);
  const existing = await poiLocalizationStore.get(db, poiId, language);
  const changed = await saveLocalizationDoc(db, settings, poiId, language, data, existing, extra);
  if (changed && poi.status === poiStore.STATUS_ACTIVE) await publishChange(db, poiId);
  return changed;
}

/**
 * Queue audio for a localization that has usable text but no valid audio and no task in flight.
 * Returns true if a task was queued.
 */
export async function ensureAudio(db, poiId, language) {
  const loc = await poiLocalizationStore.get(db, poiId, language);
  if (!isUsable(loc) || hasValidAudio(loc)) return false;
  if (loc.audio_status === 'pending') return false; // a task is already queued / running
  const text = narrationText(loc);
  if (!text) return false;
  const contentHash = computeContentHash(language, text);
  await poiLocalizationStore.upsert(db, {
    ...loc, content_hash: contentHash, audio_status: 'pending', audio_error: null, updated_at: new Date(),
  });
  await audioTaskStore.enqueue(db, { poiId, language, text, contentHash });
  return true;
}

export async function getAdminView(db, poiId) {
  const poi = await poiStore.get(db, poiId);
  if (!poi) throw new NotFoundError(`POI '${poiId}' not found`);
  const locs = await poiLocalizationStore.listForPoi(db, poiId);
  const [lat, lng] = poiCoordinates(poi);
  return {
    poi_id: poiId,
    status: poi.status,
    latitude: lat,
    longitude: lng,
    radius_meters: poi.radius_meters,
    priority: poi.priority ?? 0,
    images: poi.images ?? [],
    map_url: poi.map_url ?? null,
    dataset_version: poi.dataset_version ?? null,
    created_at: iso(poi.created_at),
    updated_at: iso(poi.updated_at),
    localizations: Object.fromEntries(
      Object.entries(locs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([language, loc]) => [language, {
        name: loc.name ?? null,
        description: loc.description ?? null,
        tts_script: loc.tts_script ?? null,
        audio_status: loc.audio_status ?? null,
        audio_url: hasValidAudio(loc) ? loc.audio_url : null,
      }]),
    ),
    readiness: evaluateReadiness(locs[REQUIRED_LANGUAGE]),
  };
}

// ---- Lifecycle -----------------------------------------------------------------------------------
export async function createPoi(db, settings, data) {
  const poiId = data.poi_id || `poi-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const now = new Date();
  await poiStore.insert(db, {
    poi_id: poiId,
    status: poiStore.STATUS_DRAFT,
    location: { type: 'Point', coordinates: [data.longitude, data.latitude] },
    radius_meters: data.radius_meters,
    priority: data.priority,
    images: [...data.images],
    map_url: data.map_url ?? null,
    dataset_version: null,
    created_at: now,
    updated_at: now,
  });
  for (const [language, loc] of Object.entries(data.localizations)) {
    await saveLocalizationDoc(db, settings, poiId, language, loc, null);
  }
  return getAdminView(db, poiId);
}

/** `update` = { data, sent } from parsePoiUpdate. */
export async function updatePoi(db, settings, poiId, update) {
  const { data, sent } = update;
  const poi = await poiStore.get(db, poiId);
  if (!poi) throw new NotFoundError(`POI '${poiId}' not found`);

  const fields = {};
  const [oldLat, oldLng] = poiCoordinates(poi);
  const newLat = data.latitude ?? oldLat;
  const newLng = data.longitude ?? oldLng;
  if (newLat !== oldLat || newLng !== oldLng) fields.location = { type: 'Point', coordinates: [newLng, newLat] };
  for (const name of ['radius_meters', 'priority']) {
    const value = data[name];
    if (sent.has(name) && value !== null && value !== undefined && value !== poi[name]) fields[name] = value;
  }
  if (sent.has('images') && data.images !== null && JSON.stringify(data.images) !== JSON.stringify(poi.images ?? [])) {
    fields.images = [...data.images];
  }
  if (sent.has('map_url') && (data.map_url ?? null) !== (poi.map_url ?? null)) fields.map_url = data.map_url ?? null;

  let changed = Object.keys(fields).length > 0;
  if (data.localizations && Object.keys(data.localizations).length) {
    const existingLocs = await poiLocalizationStore.listForPoi(db, poiId);
    for (const [language, loc] of Object.entries(data.localizations)) {
      if (await saveLocalizationDoc(db, settings, poiId, language, loc, existingLocs[language])) changed = true;
    }
  }

  if (changed) {
    fields.updated_at = new Date();
    await poiStore.updateFields(db, poiId, fields);
    if (poi.status === poiStore.STATUS_ACTIVE) await publishChange(db, poiId);
  }
  return getAdminView(db, poiId);
}

/**
 * Make a POI public. `force` skips the readiness check (English content + audio); it is only for the demo
 * seed script (scripts/seed-pois.js), never for the normal flow.
 */
export async function activatePoi(db, poiId, { force = false } = {}) {
  const poi = await poiStore.get(db, poiId);
  if (!poi) throw new NotFoundError(`POI '${poiId}' not found`);
  if (poi.status === poiStore.STATUS_ACTIVE) return getAdminView(db, poiId);

  if (!force) {
    const report = await checkReadiness(db, poiId);
    if (!report.ready) throw new NotReadyError(report);
  }

  const version = await poiDatasetStore.bumpVersion(db);
  const now = new Date();
  await poiStore.updateFields(db, poiId, {
    status: poiStore.STATUS_ACTIVE,
    dataset_version: version,
    activated_at: now,
    updated_at: now,
  });
  await poiDatasetStore.removeTombstone(db, poiId); // re-activated id is not "removed"
  return getAdminView(db, poiId);
}

export async function deletePoi(db, settings, poiId) {
  const poi = await poiStore.get(db, poiId);
  if (!poi) throw new NotFoundError(`POI '${poiId}' not found`);
  const wasPublic = poi.status === poiStore.STATUS_ACTIVE;

  const locs = await poiLocalizationStore.listForPoi(db, poiId);
  const audioPaths = Object.values(locs).filter((l) => l.audio_path).map((l) => l.audio_path);

  // Remove the POI first so it is no longer served, then everything related.
  await poiStore.remove(db, poiId);
  await poiLocalizationStore.deleteForPoi(db, poiId);
  await audioTaskStore.deleteForPoi(db, poiId);

  if (wasPublic) {
    const version = await poiDatasetStore.bumpVersion(db);
    await poiDatasetStore.addTombstone(db, poiId, version, new Date());
  }
  // Media cleanup is best-effort and runs last: a failure must not undo the delete.
  for (const p of audioPaths) await deleteFile(settings, p);
}

// ---- Audio results (called by the audio module / worker) -----------------------------------------
/**
 * Attach a generated audio file. Returns false (and deletes the file) if the text changed or the POI was
 * deleted while the audio was being generated.
 */
export async function completeAudio(db, settings, {
  poiId, language, contentHash, audioPath, audioUrl, audioSha256 = null, audioSize = null,
}) {
  const loc = await poiLocalizationStore.get(db, poiId, language);
  if (!loc || loc.content_hash !== contentHash) {
    await deleteFile(settings, audioPath);
    return false;
  }
  const oldPath = loc.audio_path;
  const ok = await poiLocalizationStore.markAudioReady(db, {
    poiId, language, contentHash, audioPath, audioUrl, audioSha256, audioSize, now: new Date(),
  });
  if (!ok) {
    await deleteFile(settings, audioPath);
    return false;
  }
  if (oldPath && oldPath !== audioPath) await deleteFile(settings, oldPath);
  const poi = await poiStore.get(db, poiId);
  if (poi && poi.status === poiStore.STATUS_ACTIVE) await publishChange(db, poiId); // clients pick up the new audio
  return true;
}

/** A failed audio is being retried: show it as pending again. */
export function resetAudioPending(db, { poiId, language, contentHash }) {
  return poiLocalizationStore.markAudioPending(db, { poiId, language, contentHash, now: new Date() });
}

export function failAudio(db, { poiId, language, contentHash, error }) {
  return poiLocalizationStore.markAudioFailed(db, { poiId, language, contentHash, error, now: new Date() });
}
