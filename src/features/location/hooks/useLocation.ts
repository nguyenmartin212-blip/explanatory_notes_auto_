import { useState } from 'react';
import type { UserLocation } from '../types';

export function useLocation() {
  const [location] = useState<UserLocation | null>(null);

  return {
    location,
    permissionStatus: 'not-requested' as const,
    isTracking: false,
  };
}
