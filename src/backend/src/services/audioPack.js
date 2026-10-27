// GET /audio/pack-manifest: the list of audio files an app can download offline.
// Only audio of public (active) POIs that is ready and matches the current text is listed. `pack_version` is
// content-addressed: the first 16 hex chars of the SHA-256 of the sorted "path:sha256" lines, so it changes
// if and only if a file changes, is added or is removed.
import crypto from 'node:crypto';
import { hasValidAudio } from './localizationFallback.js';
import { iso } from './poiPayload.js';
import { poiDatasetStore, poiLocalizationStore, poiStore } from '../stores/index.js';

export const makePackEtag = (packVersion) => `W/"pack-${packVersion}"`;

export function computePackVersion(files) {
  const lines = files.map((f) => `${f.path}:${f.sha256}`).sort().join('\n');
  return crypto.createHash('sha256').update(lines, 'utf8').digest('hex').slice(0, 16);
}

export async function buildManifest(db, { lang = null } = {}) {
  const datasetVersion = await poiDatasetStore.getVersion(db);
  const pois = (await poiStore.listActive(db)).sort((a, b) => (a.poi_id < b.poi_id ? -1 : 1));
  const locs = await poiLocalizationStore.listForPois(db, pois.map((p) => p.poi_id));

  const files = [];
  for (const poi of pois) {
    const entries = Object.entries(locs[poi.poi_id] || {}).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [language, loc] of entries) {
      if (lang && language !== lang) continue;
      if (!(hasValidAudio(loc) && loc.audio_path && loc.audio_sha256)) continue;
      files.push({
        poi_id: poi.poi_id,
        language,
        url: loc.audio_url,
        path: loc.audio_path,
        size: loc.audio_size ?? null,
        sha256: loc.audio_sha256,
      });
    }
  }
  return {
    pack_version: computePackVersion(files),
    dataset_version: datasetVersion,
    language: lang,
    generated_at: iso(new Date()),
    count: files.length,
    total_bytes: files.reduce((sum, f) => sum + (f.size || 0), 0),
    files,
  };
}
