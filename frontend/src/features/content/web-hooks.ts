import { useCallback, useEffect, useRef, useState } from 'react';
import type { Poi } from '@/features/poi/types';
import { getLanguages, getPois, getRegions, mapPoi, type ApiPoi, type ContentLanguage, type Region } from '@/features/poi/api';
import { apiGet } from '@/services/apiClient';
import { apiMediaUrl } from '@/services/apiConfig';

const OFFLINE_INDEX = 'gth-sql-offline-index';
const offlineKey = (lang: string) => new URL(`/offline-data/${encodeURIComponent(lang)}`, window.location.origin).href;
const versionQuery = (lang: string) => new URLSearchParams({ lang });

type OfflineManifest = {
  version: string;
  items: ApiPoi[];
};
type OfflineEntry = { version: string; cacheName: string; pois: Poi[]; skippedImages: number };

async function getOfflineEntry(lang: string): Promise<OfflineEntry | null> {
  if (!('caches' in window)) return null;
  const index = await caches.open(OFFLINE_INDEX);
  return (await index.match(offlineKey(lang)))?.json() ?? null;
}

export async function getOfflineAudio(path: string, lang: string) {
  const entry = await getOfflineEntry(lang).catch(() => null);
  const response = entry && await caches.match(apiMediaUrl(path), { cacheName: entry.cacheName });
  return response ? URL.createObjectURL(await response.blob()) : null;
}

async function saveOffline(lang: string, onProgress: (done: number, total: number) => void) {
  const query = versionQuery(lang);
  const manifest = await apiGet<OfflineManifest>(`/api/v1/offline/manifest?${query}`);
  const pois = manifest.items.map(mapPoi);
  const audio = new Set(pois.flatMap(({ content }) => content.audio_url ? [apiMediaUrl(content.audio_url)] : []));
  const images = new Set(pois.flatMap((poi) => poi.images.map(apiMediaUrl)));
  const cacheName = `gth-sql-offline-media-${lang}-${manifest.version}-${crypto.randomUUID()}`;
  const cache = await caches.open(cacheName);
  const index = await caches.open(OFFLINE_INDEX);
  const previous = await getOfflineEntry(lang);
  let skippedImages = 0;
  let done = 0;
  const files = new Set([...audio, ...images]);
  onProgress(done, files.size);
  try {
    for (const url of files) {
      try {
        const response = await fetch(url, { credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await cache.put(url, response);
      } catch (error) {
        if (audio.has(url)) throw error;
        skippedImages += 1;
      }
      onProgress(++done, files.size);
    }
    const entry: OfflineEntry = { version: manifest.version, cacheName, pois, skippedImages };
    await index.put(offlineKey(lang), new Response(JSON.stringify(entry)));
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
  if (previous) await caches.delete(previous.cacheName).catch(() => false);
  return skippedImages;
}

export async function loadBrowserPois(lang: string) {
  try {
    const pois = await getPois(lang);
    return { pois, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const offline = await getOfflineEntry(lang).catch(() => null);
    const warning = ['Không tải được dữ liệu điểm tham quan.', message].filter(Boolean).join(' ');
    return offline ? { pois: offline.pois, warning: `${warning} Đang dùng gói đã tải.` } : { pois: [], warning };
  }
}

export function useBrowserPois(lang = 'vi') {
  const [pois, setPois] = useState<Poi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      setIsLoading(true);
      const result = await loadBrowserPois(lang);
      if (!active) return;
      setPois(result.pois);
      setError(result.warning);
      setIsLoading(false);
    }
    void refresh();
    window.addEventListener('online', refresh);
    return () => { active = false; window.removeEventListener('online', refresh); };
  }, [lang]);

  return { pois, isLoading, error };
}

export function useVisitorOptions() {
  const [languages, setLanguages] = useState<ContentLanguage[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    async function load<T>(key: string, request: () => Promise<T[]>, set: (items: T[]) => void) {
      try {
        const items = await request();
        if (!active) return;
        if (!Array.isArray(items)) throw new Error('API không trả về danh sách.');
        set(items);
        setErrors((current) => ({ ...current, [key]: '' }));
        try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* optional cache */ }
      } catch {
        if (!active) return;
        const label = key.endsWith('languages') ? 'ngôn ngữ' : 'miền';
        setErrors((current) => ({ ...current, [key]: `Không tải được danh sách ${label}.` }));
        try { set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { /* optional cache */ }
      }
    }
    const refresh = () => {
      void load('gth-sql-languages', getLanguages, setLanguages);
      void load('gth-sql-regions', getRegions, setRegions);
    };
    refresh();
    window.addEventListener('online', refresh);
    return () => { active = false; window.removeEventListener('online', refresh); };
  }, []);
  return { languages, regions, optionsError: Object.values(errors).filter(Boolean).join(' ') };
}

export function useOfflineDownload(lang: string) {
  const [status, setStatus] = useState('');
  const busy = useRef(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const selectedLanguage = useRef(lang);
  selectedLanguage.current = lang;
  const supported = import.meta.env.PROD && 'serviceWorker' in navigator && 'caches' in window;

  const download = useCallback(async (automatic = false) => {
    if (!supported || busy.current) return;
    busy.current = true;
    const report = (message: string) => { if (selectedLanguage.current === lang) setStatus(message); };
    try {
      if (automatic) {
        const current = await getOfflineEntry(lang);
        if (!current) return;
        report('Đã tải gói ngoại tuyến.');
        const online = await apiGet<{ version: string }>(`/api/v1/offline/version?${versionQuery(lang)}`);
        if (online.version === current.version) return;
      }
      setIsDownloading(true);
      const skipped = await saveOffline(lang, (done, total) => report(`Đang tải ${done}/${total} tệp…`));
      report(skipped ? `Đã tải gói. Không tải được ${skipped} ảnh.` : 'Đã tải gói ngoại tuyến.');
    } catch {
      if (!automatic || navigator.onLine) report('Chưa tải được gói ngoại tuyến. Bạn có thể thử lại.');
    } finally {
      busy.current = false;
      setIsDownloading(false);
    }
  }, [lang, supported]);

  useEffect(() => {
    setStatus('');
    const sync = () => { void download(true); };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [download]);

  return { status, isDownloading, supported, download };
}
