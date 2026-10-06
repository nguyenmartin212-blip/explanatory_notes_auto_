import type { Poi } from './types';

export const mockPois: Poi[] = [
  {
    id: 'hanoi-thang-long',
    name: { vi: 'Hoàng thành Thăng Long', en: 'Imperial Citadel of Thang Long' },
    description: {
      vi: 'Di sản lịch sử tiêu biểu của Hà Nội.',
      en: 'A major historical heritage site in Hanoi.',
    },
    latitude: 21.0353,
    longitude: 105.8402,
    radiusMeters: 80,
    priority: 10,
    images: [],
    ttsScript: {
      vi: 'Bạn đang ở gần Hoàng thành Thăng Long.',
      en: 'You are near the Imperial Citadel of Thang Long.',
    },
  },
];
