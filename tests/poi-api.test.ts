import { parsePoiList } from '../src/features/poi/api';

const poi = {
  id: 'sample-place',
  name: { vi: 'Địa điểm mẫu', en: 'Sample place' },
  description: { vi: 'Mô tả mẫu', en: 'Sample description' },
  latitude: 10.77,
  longitude: 106.7,
  radiusMeters: 80,
  priority: 4,
  images: [],
};

describe('POI API response parsing', () => {
  it('accepts a valid POI list', () => {
    expect(parsePoiList([poi])).toEqual([poi]);
  });

  it('accepts an empty active POI list', () => {
    expect(parsePoiList([])).toEqual([]);
  });

  it('rejects malformed response shapes', () => {
    expect(() => parsePoiList({ pois: [poi] })).toThrow('must be an array');
    expect(() => parsePoiList([{ ...poi, latitude: '10.77' }])).toThrow('invalid item');
  });
});
