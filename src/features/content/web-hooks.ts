import { useCallback, useEffect, useState } from 'react';
import type { Poi } from '@/features/poi';
import { getPois, parsePoiList } from '@/features/poi/api';
import { mockPois } from '@/features/poi/mockData';

const WEB_POI_CACHE_KEY = 'go-to-horizon-pois-v1';
export type BrowserPoiSource = 'network' | 'browser' | 'demo';

export async function loadBrowserPois() {
  try {
    const pois = await getPois();
    if (pois.length > 0) {
      window.localStorage.setItem(WEB_POI_CACHE_KEY, JSON.stringify(pois));
      return {
        pois,
        source: 'network' as const,
        warning: null,
      };
    }
    return {
      pois: mockPois,
      source: 'demo' as const,
      warning: 'Backend chưa có POI hoạt động; đang hiển thị dữ liệu mẫu.',
    };
  } catch (networkError) {
    const networkMessage = networkError instanceof Error
      ? networkError.message
      : 'Không thể kết nối backend.';

    try {
      const cachedValue = window.localStorage.getItem(WEB_POI_CACHE_KEY);
      if (cachedValue) {
        const cachedPois = parsePoiList(JSON.parse(cachedValue));
        if (cachedPois.length > 0) {
          return {
            pois: cachedPois,
            source: 'browser' as const,
            warning: `Đang dùng dữ liệu đã lưu trên trình duyệt. ${networkMessage}`,
          };
        }
      }
    } catch (cacheError) {
      const cacheMessage = cacheError instanceof Error
        ? cacheError.message
        : 'Không đọc được dữ liệu POI đã lưu.';
      return {
        pois: mockPois,
        source: 'demo' as const,
        warning: `${networkMessage} ${cacheMessage} Đang hiển thị dữ liệu mẫu.`,
      };
    }

    return {
      pois: mockPois,
      source: 'demo' as const,
      warning: `${networkMessage} Đang hiển thị dữ liệu mẫu.`,
    };
  }
}

export function useBrowserPois() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<BrowserPoiSource | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await loadBrowserPois();
      setPois(result.pois);
      setSource(result.source);
      setError(result.warning);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải POI.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pois, isLoading, error, source, refresh };
}
