import { apiGet } from '@/services';
import type { Poi } from './types';

export function getPois() {
  return apiGet<Poi[]>('/pois');
}
