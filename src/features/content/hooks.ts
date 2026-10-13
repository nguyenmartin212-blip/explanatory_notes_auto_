import { useCallback, useEffect, useState } from 'react';
import type { Poi } from '@/features/poi';
import { getOfflinePoiById, getOfflinePois } from './database';

export function useOfflinePois() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPois(await getOfflinePois());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu POI offline.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pois, isLoading, error, refresh };
}

export function useOfflinePoi(id: string) {
  const [poi, setPoi] = useState<Poi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setPoi(await getOfflinePoiById(id));
      setError(null);
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
