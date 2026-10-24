import type { Poi } from '@/features/poi';
import type { UserLocation } from '@/features/location';
import { evaluatePoi } from './geofence.engine';

const DEFAULT_EXIT_MULTIPLIER = 1.25;
const MAX_FIX_AGE_MS = 15_000;

export function isReliableOutsideGeofence(
  location: UserLocation,
  poi: Poi,
  now = Date.now(),
): boolean {
  const maxAccuracy = Math.min(75, poi.radiusMeters);
  const accuracy = location.accuracy;
  const isReliable =
    accuracy !== undefined &&
    Number.isFinite(accuracy) &&
    accuracy >= 0 &&
    accuracy <= maxAccuracy &&
    Math.abs(now - location.timestamp) <= MAX_FIX_AGE_MS;

  return isReliable &&
    evaluatePoi(location, poi).distanceMeters > poi.radiusMeters * DEFAULT_EXIT_MULTIPLIER;
}
