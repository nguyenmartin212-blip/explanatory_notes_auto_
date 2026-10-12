import {
  createGeofenceRuntimeState,
  processGeofenceUpdate,
} from '../src/features/geofence';
import type { Poi } from '../src/features/poi';
import type { UserLocation } from '../src/features/location';

function makePoi(id: string, priority: number, radiusMeters = 120): Poi {
  return {
    id,
    name: { vi: id },
    description: { vi: 'Test' },
    latitude: 16.469,
    longitude: 107.5788,
    radiusMeters,
    priority,
    images: [],
  };
}

function fix(timestamp: number, latitude = 16.469, accuracy = 15): UserLocation {
  return { latitude, longitude: 107.5788, accuracy, timestamp };
}

const options = { debounceMs: 1_500, cooldownMs: 10_000, exitMultiplier: 1.25 };

describe('Geofence Engine V2', () => {
  it('debounces an entry before emitting a trigger', () => {
    const poi = makePoi('hue', 10);
    const first = processGeofenceUpdate(fix(1_000), [poi], createGeofenceRuntimeState(), 1_000, options);
    expect(first.trigger).toBeNull();

    const stable = processGeofenceUpdate(fix(2_600), [poi], first.state, 2_600, options);
    expect(stable.trigger?.poiId).toBe('hue');
    expect(stable.trigger?.reason).toBe('entered');
  });

  it('chooses the highest-priority POI when several become eligible together', () => {
    const low = makePoi('low', 2);
    const high = makePoi('high', 10);
    const first = processGeofenceUpdate(fix(1_000), [low, high], createGeofenceRuntimeState(), 1_000, options);
    const stable = processGeofenceUpdate(fix(2_600), [low, high], first.state, 2_600, options);

    expect(stable.eligible.map((item) => item.poiId)).toEqual(['high', 'low']);
    expect(stable.trigger?.poiId).toBe('high');
  });

  it('suppresses a re-entry during cooldown', () => {
    const poi = makePoi('hue', 10);
    const first = processGeofenceUpdate(fix(1_000), [poi], createGeofenceRuntimeState(), 1_000, options);
    const triggered = processGeofenceUpdate(fix(2_600), [poi], first.state, 2_600, options);
    expect(triggered.trigger?.poiId).toBe('hue');

    const exited = processGeofenceUpdate(fix(3_000, 16.49), [poi], triggered.state, 3_000, options);
    const reentry = processGeofenceUpdate(fix(4_000), [poi], exited.state, 4_000, options);
    const stableAgain = processGeofenceUpdate(fix(5_600), [poi], reentry.state, 5_600, options);
    expect(stableAgain.trigger).toBeNull();
  });

  it('keeps the inside state through small boundary jitter', () => {
    const poi = makePoi('hue', 10, 120);
    const first = processGeofenceUpdate(fix(1_000), [poi], createGeofenceRuntimeState(), 1_000, options);
    const stable = processGeofenceUpdate(fix(2_600), [poi], first.state, 2_600, options);

    // Roughly 130 m north: outside 120 m activation radius but inside 1.25x exit radius.
    const jitter = processGeofenceUpdate(fix(3_000, 16.47017), [poi], stable.state, 3_000, options);
    expect(jitter.state.insideIds.has('hue')).toBe(true);
    expect(jitter.trigger).toBeNull();
  });

  it('does not create a trigger from an inaccurate GPS fix', () => {
    const poi = makePoi('hue', 10);
    const first = processGeofenceUpdate(fix(1_000, 16.469, 180), [poi], createGeofenceRuntimeState(), 1_000, options);
    const second = processGeofenceUpdate(fix(3_000, 16.469, 180), [poi], first.state, 3_000, options);
    expect(second.trigger).toBeNull();
    expect(second.state.insideIds.size).toBe(0);
  });
});
