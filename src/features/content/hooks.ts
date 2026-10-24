import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Poi } from '@/features/poi';
import { loadPoisOfflineFirst } from './offline-defense';
import { loadBrowserPois } from './web-hooks';
type ContentSource = 'network' | 'sqlite' | 'browser' | 'demo';


export function useOfflinePois() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ContentSource | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web') {
        const result = await loadBrowserPois();
        setPois(result.pois);
        setSource(result.source);
        setError(result.warning);
      } else {
        const result = await loadPoisOfflineFirst('vi');
        setPois(result.pois);
        setSource(result.source);
        setError(result.warning ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu POI offline.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pois, isLoading, error, source, refresh };
}

export function useOfflinePoi(id: string) {
  const [poi, setPoi] = useState<Poi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web') {
        const result = await loadBrowserPois();
        setPoi(result.pois.find((item) => item.id === id) ?? null);
        setError(result.warning);
      } else {
        const result = await loadPoisOfflineFirst('vi');
        setPoi(result.pois.find((item) => item.id === id) ?? null);
        setError(result.warning ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải nội dung POI offline.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { poi, isLoading, error, refresh };
}
