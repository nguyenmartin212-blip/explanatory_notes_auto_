import { apiGet } from '@/services';
import type { Poi } from './types';

function isLocalizedText(value: unknown): value is Poi['name'] {
  return typeof value === 'object' &&
    value !== null &&
    'vi' in value &&
    typeof value.vi === 'string';
}

function isPoi(value: unknown): value is Poi {
  return typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'name' in value &&
    isLocalizedText(value.name) &&
    'description' in value &&
    isLocalizedText(value.description) &&
    'latitude' in value &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    'longitude' in value &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    'radiusMeters' in value &&
    typeof value.radiusMeters === 'number' &&
    Number.isFinite(value.radiusMeters) &&
    value.radiusMeters > 0 &&
    'priority' in value &&
    typeof value.priority === 'number' &&
    Number.isFinite(value.priority) &&
    'images' in value &&
    Array.isArray(value.images) &&
    value.images.every((image: unknown) => typeof image === 'string');
}

export function parsePoiList(value: unknown): Poi[] {
  if (!Array.isArray(value)) {
    throw new Error('POI API response must be an array.');
  }
  return value.map((item, index) => {
    if (!isPoi(item)) {
      throw new Error(`POI API response contains an invalid item at index ${index}.`);
    }
    return item;
  });
}

export function getPois() {
  return apiGet<unknown>('/pois').then(parsePoiList);
}
