import type { Poi } from '@/features/poi';
import { getPois } from '@/features/poi/api';
import { getOfflinePois, replaceOfflinePois } from './database';

/**
 * Offline-first coordinator adapted for the Expo/React Native project.
 * Layer 1: Network-first with an 8s timeout.
 * Layer 2: language shard bookkeeping + bounded LRU policy (3 languages).
 * Layer 3: SQLite snapshot fallback.
 * Layer 4: explicit POI pack installation into SQLite.
 *
 * Note: this is the native-mobile equivalent, not a PWA Service Worker. A true
 * PWA SW/cache implementation belongs in a Vite web target.
 */
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_LANG_SHARDS = 3;
const MAX_ITEMS_PER_LANG = 300;
const SUPPORTED_LANGUAGES = ['vi', 'en', 'zh', 'ko'] as const;
export type OfflineLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type OfflineResult = {
  pois: Poi[];
  source: 'network' | 'sqlite';
  language: OfflineLanguage;
  warning?: string;
};

type LanguageUsage = { language: OfflineLanguage; lastUsedAt: number };
let languageUsage: LanguageUsage[] = [];

function normalizeLanguage(language: string): OfflineLanguage {
  return SUPPORTED_LANGUAGES.includes(language as OfflineLanguage)
    ? (language as OfflineLanguage)
    : 'vi';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Network timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function touchLanguageShard(language: OfflineLanguage) {
  const now = Date.now();
  languageUsage = [
    ...languageUsage.filter((entry) => entry.language !== language),
    { language, lastUsedAt: now },
  ].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  while (languageUsage.length > MAX_LANG_SHARDS) languageUsage.shift();
}

/** Network-first data retrieval, with the existing SQLite snapshot as fallback. */
export async function loadPoisOfflineFirst(languageInput: string): Promise<OfflineResult> {
  const language = normalizeLanguage(languageInput);
  touchLanguageShard(language);
  try {
    const remotePois = await withTimeout(getPois(), REQUEST_TIMEOUT_MS);
    if (remotePois.length > 0) {
      await replaceOfflinePois(remotePois.slice(0, MAX_ITEMS_PER_LANG));
      return { pois: remotePois, source: 'network', language };
    }

    const cached = await getOfflinePois();
    if (cached.length > 0) {
      return {
        pois: cached,
        source: 'sqlite',
        language,
        warning: 'Backend chưa có POI hoạt động; đang hiển thị dữ liệu đã lưu trên thiết bị.',
      };
    }
    return { pois: [], source: 'network', language };
  } catch (error) {
    const cached = await getOfflinePois();
    if (cached.length > 0) {
      return {
        pois: cached,
        source: 'sqlite',
        language,
        warning: error instanceof Error ? error.message : 'Network unavailable',
      };
    }
    throw new Error('Không có mạng và chưa có dữ liệu offline. Hãy kết nối mạng để tải dữ liệu lần đầu.');
  }
}

/** Content fallback for a requested locale: target -> English -> Vietnamese. */
export function resolveLocalizedText(
  values: Partial<Record<OfflineLanguage, string>> | undefined,
  targetInput: string,
): string {
  const target = normalizeLanguage(targetInput);
  const candidates = [values?.[target], values?.en, values?.vi];
  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0) ?? '';
}

export function getOfflineDefenseStatus() {
  return {
    networkStrategy: 'NetworkFirst',
    networkTimeoutMs: REQUEST_TIMEOUT_MS,
    maxPoisPerSnapshot: MAX_ITEMS_PER_LANG,
    maxConcurrentLanguageShards: MAX_LANG_SHARDS,
    activeLanguageShards: languageUsage.map((entry) => entry.language),
    persistentFallback: 'expo-sqlite',
  } as const;
}

/**
 * Layer 4: explicitly install a prepared POI pack. Installation is atomic because
 * replaceOfflinePois uses a SQLite transaction. Asset/map/audio downloading is
 * intentionally separate from this data-only pack API.
 */
export async function installPoiOfflinePack(pack: { id: string; pois: Poi[] }) {
  if (!pack.id.trim()) throw new Error('Offline pack requires an id.');
  if (!Array.isArray(pack.pois) || pack.pois.length === 0) {
    throw new Error('Offline pack must contain at least one POI.');
  }
  const ids = new Set<string>();
  for (const poi of pack.pois) {
    if (!poi.id || ids.has(poi.id)) throw new Error('Offline pack has a missing or duplicate POI id.');
    if (!Number.isFinite(poi.latitude) || !Number.isFinite(poi.longitude)) {
      throw new Error(`Invalid coordinates for POI: ${poi.id}`);
    }
    ids.add(poi.id);
  }
  await replaceOfflinePois(pack.pois.slice(0, MAX_ITEMS_PER_LANG));
  return { packId: pack.id, poiCount: Math.min(pack.pois.length, MAX_ITEMS_PER_LANG), installedAt: Date.now() };
}
