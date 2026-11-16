import { apiGet } from '@/services';
import type { Poi, PoiContent } from './types';

export type ApiPoi = PoiContent & {
  id: number;
  region_code: string;
  latitude: number;
  longitude: number;
  trigger_radius: number;
  audio_priority: number;
  cover_image_url: string | null;
  image_urls: string[];
};

function isMediaUrl(value: string): boolean {
  if (!value || /\s|\\/.test(value)) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function mapPoi(item: ApiPoi): Poi {
  if (!item || !Number.isInteger(item.id) || item.id <= 0 || typeof item.region_code !== 'string' ||
      !Number.isFinite(item.latitude) || Math.abs(item.latitude) > 90 ||
      !Number.isFinite(item.longitude) || Math.abs(item.longitude) > 180 ||
      !Number.isFinite(item.trigger_radius) || item.trigger_radius <= 0 || !Number.isFinite(item.audio_priority) ||
      typeof item.name !== 'string' || typeof item.description !== 'string' || typeof item.lang !== 'string' ||
      typeof item.is_fallback !== 'boolean' || !Array.isArray(item.image_urls)) {
    throw new Error('API trả về dữ liệu điểm tham quan không đúng cấu trúc.');
  }
  const images = [item.cover_image_url, ...item.image_urls].filter((url): url is string =>
    typeof url === 'string' && isMediaUrl(url));
  return {
    id: `poi-${item.id}`,
    backendId: item.id,
    regionCode: item.region_code,
    latitude: item.latitude,
    longitude: item.longitude,
    radiusMeters: item.trigger_radius,
    priority: item.audio_priority,
    images: [...new Set(images)],
    content: {
      name: item.name,
      description: item.description,
      lang: item.lang,
      is_fallback: item.is_fallback,
      audio_url: typeof item.audio_url === 'string' && isMediaUrl(item.audio_url) ? item.audio_url : null,
    },
  };
}

export async function getPois(lang = 'vi', region?: string) {
  const limit = 100;
  const results: Poi[] = [];
  const query = new URLSearchParams({ lang, limit: String(limit) });
  if (region) query.set('region', region);
  for (let skip = 0; ; skip += limit) {
    query.set('skip', String(skip));
    const page = await apiGet<ApiPoi[]>(`/api/v1/pois?${query}`);
    if (!Array.isArray(page)) throw new Error('API không trả về danh sách điểm tham quan.');
    results.push(...page.map(mapPoi));
    if (page.length < limit) return results;
  }
}

export const getPoiDetail = async (id: number, lang: string) =>
  mapPoi(await apiGet<ApiPoi>(`/api/v1/pois/${id}?${new URLSearchParams({ lang })}`));

export type ContentLanguage = { code: string; name: string };
export type Region = { id: number; code: string; name_vi: string };

export const getLanguages = () => apiGet<ContentLanguage[]>('/api/v1/languages');
export const getRegions = () => apiGet<Region[]>('/api/v1/regions');
