// GET /poi/nearby: $geoNear first, Haversine as fallback.
import { GeoQueryUnavailable } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { buildPoiPayload, poiCoordinates } from './poiPayload.js';
import { poiLocalizationStore, poiStore } from '../stores/index.js';
import { haversineM } from '../utils/geo.js';

/** Active POIs within `radiusM`, nearest first: { source: 'geoNear' | 'haversine', found: [[poi, distance_m], ...] }. */
export async function findCandidates(db, { lat, lng, radiusM, limit }) {
  let source = 'geoNear';
  let found;
  try {
    found = await poiStore.geoNear(db, { lat, lng, maxDistanceM: radiusM, limit });
  } catch (err) {
    if (!(err instanceof GeoQueryUnavailable)) throw err;
    logger.warn(`$geoNear unavailable, falling back to Haversine: ${err.message}`);
    source = 'haversine';
    found = [];
    for (const poi of await poiStore.listActive(db)) {
      const [pLat, pLng] = poiCoordinates(poi);
      const distance = haversineM(lat, lng, pLat, pLng);
      if (distance <= radiusM) found.push([poi, distance]);
    }
    found.sort((a, b) => a[1] - b[1] || (b[0].priority ?? 0) - (a[0].priority ?? 0) || (a[0].poi_id < b[0].poi_id ? -1 : 1));
    found = found.slice(0, limit);
  }
  return { source, found };
}

export async function findNearby(db, { lat, lng, radiusM, limit, lang = null }) {
  const { source, found } = await findCandidates(db, { lat, lng, radiusM, limit });
  const locs = await poiLocalizationStore.listForPois(db, found.map(([poi]) => poi.poi_id));
  const items = found.map(([poi, distance]) => {
    const payload = buildPoiPayload(poi, locs[poi.poi_id] || {}, lang);
    payload.distance_m = Math.round(distance * 10) / 10;
    payload.inside_radius = distance <= poi.radius_meters;
    return payload;
  });
  return { source, count: items.length, pois: items };
}
