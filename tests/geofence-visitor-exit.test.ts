import { isReliableOutsideGeofence } from '../src/features/geofence';
import type { Poi } from '../src/features/poi';
import type { UserLocation } from '../src/features/location';

const poi: Poi = {
  id: 'heritage-site',
  name: { vi: 'Di tích' },
  description: { vi: 'Điểm tham quan' },
  latitude: 16.469,
  longitude: 107.5788,
  radiusMeters: 120,
  priority: 1,
  images: [],
};

function location(latitude: number, accuracy: number, timestamp: number): UserLocation {
  return { latitude, longitude: poi.longitude, accuracy, timestamp };
}

describe('visitor geofence auto checkout', () => {
  it('only considers reliable fixes beyond the exit hysteresis radius', () => {
    const now = Date.now();

    expect(isReliableOutsideGeofence(location(16.471, 20, now), poi, now)).toBe(true);
    expect(isReliableOutsideGeofence(location(16.4702, 20, now), poi, now)).toBe(false);
    expect(isReliableOutsideGeofence(location(16.471, 100, now), poi, now)).toBe(false);
    expect(isReliableOutsideGeofence(location(16.471, 20, now - 20_000), poi, now)).toBe(false);
  });
});
