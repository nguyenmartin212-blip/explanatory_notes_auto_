import type { Poi } from '@/features/poi';
import { getDistanceMeters, type Coordinates } from '@/utils';
import type { GeofenceResult } from '../types';

export function evaluatePoi(
  currentLocation: Coordinates,
  poi: Poi,
): GeofenceResult {
  const distanceMeters = getDistanceMeters(currentLocation, {
    latitude: poi.latitude,
    longitude: poi.longitude,
  });

  const state =
    distanceMeters <= poi.radiusMeters
      ? 'inside'
      : distanceMeters <= poi.radiusMeters * 1.75
        ? 'near'
        : 'outside';

  return {
    poiId: poi.id,
    distanceMeters,
    state,
  };
}

export function selectActivePoi(currentLocation: Coordinates, pois: Poi[]) {
  return pois
    .map((poi) => ({ poi, result: evaluatePoi(currentLocation, poi) }))
    .filter(({ result }) => result.state !== 'outside')
    .sort((a, b) => {
      if (a.result.state !== b.result.state) {
        return a.result.state === 'inside' ? -1 : 1;
      }
      if (a.poi.priority !== b.poi.priority) {
        return b.poi.priority - a.poi.priority;
      }
      return a.result.distanceMeters - b.result.distanceMeters;
    })[0] ?? null;
}
