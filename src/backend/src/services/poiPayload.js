// Builds the public JSON shape of a POI (shared by load-all and nearby).
import {
  fallbackChain, hasValidAudio, isUsable, narrationText, publicLocalization, resolveContent,
} from './localizationFallback.js';

// Languages of the FE `Poi` type (src/types/localized.ts: SupportedLanguage)
export const FE_LANGUAGES = ['vi', 'en', 'zh', 'ko'];

const sortedEntries = (obj) => Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function iso(value) {
  return value instanceof Date ? value.toISOString() : null;
}

/** Return [lat, lng] from the GeoJSON [lng, lat] location. */
export function poiCoordinates(poi) {
  const [lng, lat] = poi.location.coordinates;
  return [lat, lng];
}

export function buildPoiPayload(poi, localizations, lang) {
  const [lat, lng] = poiCoordinates(poi);
  const payload = {
    poi_id: poi.poi_id,
    latitude: lat,
    longitude: lng,
    radius_meters: poi.radius_meters,
    priority: poi.priority ?? 0,
    images: poi.images ?? [],
    map_url: poi.map_url ?? null,
    dataset_version: poi.dataset_version ?? null,
    updated_at: iso(poi.updated_at),
    localizations: Object.fromEntries(
      sortedEntries(localizations).filter(([, loc]) => isUsable(loc)).map(([l, loc]) => [l, publicLocalization(loc)]),
    ),
  };
  if (lang) payload.content = resolveContent(localizations, lang);
  return payload;
}

/** The FE plays `audio` from a URI, so it must be absolute. */
export function absoluteUrl(baseUrl, url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

/**
 * The POI exactly as the FE type `Poi` (src/features/poi/types.ts):
 *   id, name, description (LocalizedText: `vi` always present), latitude, longitude,
 *   radiusMeters, priority, images, mapUrl?, audio?, ttsScript?
 * Only the FE languages are sent. A missing Vietnamese text is filled from the fallback chain (vi -> en)
 * because the FE type requires `vi`.
 */
export function buildClientPoi(poi, localizations, baseUrl) {
  const [lat, lng] = poiCoordinates(poi);
  const usable = Object.fromEntries(
    Object.entries(localizations).filter(([lang, loc]) => FE_LANGUAGES.includes(lang) && isUsable(loc)),
  );
  const fbKey = fallbackChain('vi').find((l) => isUsable(localizations[l]));
  const fallback = fbKey ? localizations[fbKey] : null;

  const name = Object.fromEntries(sortedEntries(usable).map(([l, loc]) => [l, loc.name]));
  const description = Object.fromEntries(sortedEntries(usable).map(([l, loc]) => [l, loc.description]));
  if (!('vi' in usable)) {
    name.vi = fallback?.name ?? poi.poi_id;
    description.vi = fallback?.description ?? '';
  }

  const out = {
    id: poi.poi_id,
    name,
    description,
    latitude: lat,
    longitude: lng,
    radiusMeters: poi.radius_meters,
    priority: poi.priority ?? 0,
    images: [...(poi.images ?? [])],
  };
  if (poi.map_url) out.mapUrl = poi.map_url;

  const audio = Object.fromEntries(
    sortedEntries(usable).filter(([, loc]) => hasValidAudio(loc)).map(([l, loc]) => [l, absoluteUrl(baseUrl, loc.audio_url)]),
  );
  if (Object.keys(audio).length) out.audio = audio;

  const scripts = Object.fromEntries(
    sortedEntries(usable).filter(([, loc]) => (loc.tts_script || '').trim()).map(([l, loc]) => [l, loc.tts_script.trim()]),
  );
  if (Object.keys(scripts).length) {
    if (!('vi' in scripts)) scripts.vi = narrationText(fallback || {});
    out.ttsScript = scripts;
  }
  return out;
}
