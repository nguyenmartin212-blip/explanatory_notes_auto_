// Request models for the localization lane.
import { supportedLanguage } from './content.js';
import { Collector, num, requireBody, str } from './validate.js';

export function parseHotset(body) {
  requireBody(body);
  const c = new Collector();
  const out = {};
  if (!('lat' in body)) c.add('lat', 'Field required'); else out.lat = num(c, 'lat', body.lat, { min: -90, max: 90 });
  if (!('lng' in body)) c.add('lng', 'Field required'); else out.lng = num(c, 'lng', body.lng, { min: -180, max: 180 });
  if (!('lang' in body)) c.add('lang', 'Field required'); else out.lang = supportedLanguage(c, 'lang', body.lang);
  c.throwIfAny();
  return out;
}

export function parseOnDemand(body) {
  requireBody(body);
  const c = new Collector();
  const out = {};
  if (!('poi_id' in body)) c.add('poi_id', 'Field required');
  else out.poi_id = str(c, 'poi_id', body.poi_id, { min: 1, max: 100, strip: true });
  if (!('lang' in body)) c.add('lang', 'Field required'); else out.lang = supportedLanguage(c, 'lang', body.lang);
  c.throwIfAny();
  return out;
}

/** `lang` omitted: warm every supported language. */
export function parseWarmup(body) {
  const c = new Collector();
  const out = { lang: null };
  if (body && typeof body === 'object' && body.lang !== undefined && body.lang !== null) {
    out.lang = supportedLanguage(c, 'lang', body.lang);
  }
  c.throwIfAny();
  return out;
}
