import type { Poi } from '@/features/poi';
import type { UserLocation } from '@/features/location';
import { evaluatePoi } from './geofence.engine';
import type {
  GeofenceRuntimeOptions,
  GeofenceRuntimeState,
  GeofenceTrigger,
} from '../types';

const DEFAULT_DEBOUNCE_MS = 1_500;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1_000;
const DEFAULT_EXIT_MULTIPLIER = 1.25;

export function createGeofenceRuntimeState(): GeofenceRuntimeState {
  return {
    insideIds: new Set<string>(),
    pendingSince: new Map<string, number>(),
    lastTriggeredAt: new Map<string, number>(),
  };
}

/** Avoid arrival events when GPS uncertainty is larger than the POI radius. */
export function isReliableForArrival(location: UserLocation, poi: Poi) {
  return location.accuracy !== undefined &&
    location.accuracy >= 0 &&
    location.accuracy <= Math.min(75, poi.radiusMeters);
}

function rankTriggers(a: GeofenceTrigger, b: GeofenceTrigger) {
  if (a.state !== b.state) return a.state === 'inside' ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.distanceMeters - b.distanceMeters;
}

/**
 * Geofence Engine V2 foreground session.
 *
 * - rejects unreliable GPS fixes
 * - debounces entry to reduce GPS jitter
 * - uses hysteresis when leaving a POI
 * - applies a per-POI cooldown
 * - if several POIs qualify together, chooses inside -> priority -> distance
 *
 * The function is pure with respect to the supplied state: it returns a new
 * state object, which makes the behaviour easy to unit-test.
 */
export function processGeofenceUpdate(
  location: UserLocation,
  pois: Poi[],
  previous: GeofenceRuntimeState,
  now = location.timestamp || Date.now(),
  options: GeofenceRuntimeOptions = {},
) {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const exitMultiplier = options.exitMultiplier ?? DEFAULT_EXIT_MULTIPLIER;
  const triggerOnNear = options.triggerOnNear ?? false;

  const next: GeofenceRuntimeState = {
    insideIds: new Set(previous.insideIds),
    pendingSince: new Map(previous.pendingSince),
    lastTriggeredAt: new Map(previous.lastTriggeredAt),
  };
  const eligible: GeofenceTrigger[] = [];

  for (const poi of pois) {
    const result = evaluatePoi(location, poi);
    const wasInside = previous.insideIds.has(poi.id);

    // Poor accuracy must not create an arrival or falsely prove an exit.
    if (!isReliableForArrival(location, poi)) continue;

    const inTriggerZone = result.state === 'inside' || (triggerOnNear && result.state === 'near');

    if (inTriggerZone) {
      next.insideIds.add(poi.id);

      // A new physical entry starts a debounce window. If it was already
      // pending, preserve the original timestamp across GPS updates.
      const pendingSince = previous.pendingSince.get(poi.id) ?? now;
      const alreadySettledInside = wasInside && !previous.pendingSince.has(poi.id);

      if (!alreadySettledInside) {
        next.pendingSince.set(poi.id, pendingSince);
        const stableLongEnough = now - pendingSince >= debounceMs;

        if (stableLongEnough) {
          next.pendingSince.delete(poi.id);
          const lastTriggered = previous.lastTriggeredAt.get(poi.id);
          const cooldownPassed = lastTriggered === undefined || now - lastTriggered >= cooldownMs;

          if (cooldownPassed) {
            eligible.push({
              ...result,
              priority: poi.priority,
              reason: result.state === 'inside' ? 'entered' : 'nearby',
              triggeredAt: now,
            });
          }
          // If cooldown blocks this entry, settle it silently. It can trigger
          // again only after the user exits and re-enters.
        }
      }
      continue;
    }

    // Exit hysteresis avoids enter/exit spam around the radius boundary.
    if (wasInside && result.distanceMeters <= poi.radiusMeters * exitMultiplier) {
      next.insideIds.add(poi.id);
      continue;
    }

    next.insideIds.delete(poi.id);
    next.pendingSince.delete(poi.id);
  }

  eligible.sort(rankTriggers);
  const trigger = eligible[0] ?? null;
  if (trigger) next.lastTriggeredAt.set(trigger.poiId, now);

  return { state: next, trigger, eligible };
}

/**
 * Backwards-compatible helper used by older tests/callers.
 * It intentionally keeps the old immediate-entry semantics.
 */
export function newlyEnteredPoiIds(
  location: UserLocation,
  pois: Poi[],
  previouslyInside: ReadonlySet<string>,
) {
  const currentInside = new Set<string>();
  const newlyEntered: string[] = [];

  for (const poi of pois) {
    const result = evaluatePoi(location, poi);
    if (!isReliableForArrival(location, poi)) {
      if (previouslyInside.has(poi.id)) currentInside.add(poi.id);
      continue;
    }
    if (result.state === 'inside') {
      currentInside.add(poi.id);
      if (!previouslyInside.has(poi.id)) newlyEntered.push(poi.id);
    } else if (
      previouslyInside.has(poi.id) &&
      result.distanceMeters <= poi.radiusMeters * DEFAULT_EXIT_MULTIPLIER
    ) {
      currentInside.add(poi.id);
    }
  }

  return { currentInside, newlyEntered };
}
