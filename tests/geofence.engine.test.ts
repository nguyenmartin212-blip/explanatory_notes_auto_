import { evaluatePoi } from '../src/features/geofence';
import type { Poi } from '../src/features/poi';

const poi: Poi = {
  id: 'test',
  name: { vi: 'Test POI' },
  description: { vi: 'Test' },
  latitude: 10.0,
  longitude: 106.0,
  radiusMeters: 100,
  priority: 1,
  images: [],
};

describe('geofence engine', () => {
  it('detects a user inside the POI radius', () => {
    const result = evaluatePoi({ latitude: 10.0001, longitude: 106.0001 }, poi);
    expect(result.state).toBe('inside');
  });

  it('detects a user outside the POI radius', () => {
    const result = evaluatePoi({ latitude: 10.01, longitude: 106.01 }, poi);
    expect(result.state).toBe('outside');
  });
});
