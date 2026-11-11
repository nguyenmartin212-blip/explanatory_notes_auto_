// Request models for the content module (POI lifecycle).
import { Collector, isObject, num, requireBody, str, strList } from './validate.js';

export const SUPPORTED_LANGUAGES = ['vi', 'en', 'zh', 'ja', 'ko'];
// Same rule as the FE (cleanId in src/features/qr/services/qr-content.ts: /^[a-z0-9][a-z0-9-]{1,80}$/i)
export const POI_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{1,80}$/;
// Same value as the FE (DEFAULT_GEOFENCE_RADIUS_METERS in src/constants/app.ts)
export const DEFAULT_RADIUS_METERS = 80;

export function supportedLanguage(c, loc, value) {
  if (typeof value !== 'string') { c.add(loc, 'Input should be a valid string'); return undefined; }
  if (!SUPPORTED_LANGUAGES.includes(value)) {
    c.add(loc, `Unsupported language '${value}'; supported: ${JSON.stringify(SUPPORTED_LANGUAGES)}`);
    return undefined;
  }
  return value;
}

/** Content of one language. Writing a language replaces that language's content. */
export function parseLocalization(c, loc, raw) {
  if (!isObject(raw)) { c.add(loc, 'Input should be a valid object'); return undefined; }
  const out = { name: undefined, description: '', tts_script: null };
  if (!('name' in raw)) c.add([...loc, 'name'], 'Field required');
  else out.name = str(c, [...loc, 'name'], raw.name, { min: 1, max: 200, strip: true });
  if ('description' in raw) out.description = str(c, [...loc, 'description'], raw.description, { max: 5000, strip: true });
  if ('tts_script' in raw && raw.tts_script !== null) {
    out.tts_script = str(c, [...loc, 'tts_script'], raw.tts_script, { max: 5000, strip: true });
  }
  return out;
}

function parseLocalizations(c, raw) {
  if (!isObject(raw)) { c.add('localizations', 'Input should be a valid object'); return undefined; }
  const bad = Object.keys(raw).filter((k) => !SUPPORTED_LANGUAGES.includes(k)).sort();
  if (bad.length) {
    c.add('localizations', `Unsupported language(s) ${JSON.stringify(bad)}; supported: ${JSON.stringify(SUPPORTED_LANGUAGES)}`);
    return undefined;
  }
  const out = {};
  for (const [lang, value] of Object.entries(raw)) out[lang] = parseLocalization(c, ['localizations', lang], value);
  return out;
}

export function parsePoiCreate(body) {
  requireBody(body);
  const c = new Collector();
  const data = {
    poi_id: null, latitude: undefined, longitude: undefined, radius_meters: DEFAULT_RADIUS_METERS,
    priority: 0, images: [], map_url: null, localizations: {},
  };
  if ('poi_id' in body && body.poi_id !== null) data.poi_id = str(c, 'poi_id', body.poi_id, { pattern: POI_ID_PATTERN });
  if (!('latitude' in body)) c.add('latitude', 'Field required');
  else data.latitude = num(c, 'latitude', body.latitude, { min: -90, max: 90 });
  if (!('longitude' in body)) c.add('longitude', 'Field required');
  else data.longitude = num(c, 'longitude', body.longitude, { min: -180, max: 180 });
  if ('radius_meters' in body) data.radius_meters = num(c, 'radius_meters', body.radius_meters, { min: 1, max: 5000, integer: true });
  if ('priority' in body) data.priority = num(c, 'priority', body.priority, { min: 0, max: 1000, integer: true });
  if ('images' in body) data.images = strList(c, 'images', body.images, { max: 50 });
  if ('map_url' in body && body.map_url !== null) data.map_url = str(c, 'map_url', body.map_url, { max: 2000 });
  if ('localizations' in body) data.localizations = parseLocalizations(c, body.localizations);
  c.throwIfAny();
  return data;
}

/** Partial update: only fields that are sent are changed. Returns { data, sent }. */
export function parsePoiUpdate(body) {
  requireBody(body);
  const c = new Collector();
  const sent = new Set(Object.keys(body));
  const data = {
    latitude: null, longitude: null, radius_meters: null, priority: null, images: null, map_url: null, localizations: null,
  };
  const opt = (key, fn) => { if (key in body && body[key] !== null) data[key] = fn(body[key]); };
  opt('latitude', (v) => num(c, 'latitude', v, { min: -90, max: 90 }));
  opt('longitude', (v) => num(c, 'longitude', v, { min: -180, max: 180 }));
  opt('radius_meters', (v) => num(c, 'radius_meters', v, { min: 1, max: 5000, integer: true }));
  opt('priority', (v) => num(c, 'priority', v, { min: 0, max: 1000, integer: true }));
  opt('images', (v) => strList(c, 'images', v, { max: 50 }));
  opt('map_url', (v) => str(c, 'map_url', v, { max: 2000 }));
  opt('localizations', (v) => parseLocalizations(c, v));
  c.throwIfAny();
  return { data, sent };
}
