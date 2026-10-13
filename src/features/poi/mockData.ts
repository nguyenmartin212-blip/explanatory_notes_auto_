import type { Poi } from './types';

// Dữ liệu minh họa MVP; thay bằng API/content CMS khi backend sẵn sàng.
export const mockPois: Poi[] = [
  {
    id: 'hanoi-thang-long',
    name: {
      vi: 'Hoàng thành Thăng Long',
      en: 'Imperial Citadel of Thang Long',
      zh: '升龙皇城',
    },
    description: {
      vi: 'Quần thể di sản giữa lòng Hà Nội, nơi lưu giữ nhiều lớp dấu tích của các triều đại Việt Nam.',
      en: 'A heritage complex in the heart of Hanoi preserving traces of successive Vietnamese dynasties.',
      zh: '位于河内市中心的历史遗产群，保留着越南多个朝代的历史印记。',
    },
    latitude: 21.0353,
    longitude: 105.8402,
    radiusMeters: 80,
    priority: 10,
    images: [],
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=21.0353,105.8402',
    ttsScript: {
      vi: 'Hoàng thành Thăng Long là không gian di sản lịch sử tiêu biểu tại Hà Nội.',
      en: 'The Imperial Citadel of Thang Long is an important historic heritage site in Hanoi.',
      zh: '升龙皇城是河内重要的历史文化遗产。',
    },
  },
  {
    id: 'hue-imperial-city',
    name: {
      vi: 'Đại Nội Huế',
      en: 'Hue Imperial City',
      zh: '顺化皇城',
    },
    description: {
      vi: 'Không gian kiến trúc cung đình của triều Nguyễn, gắn với lịch sử cố đô Huế.',
      en: 'The Nguyen dynasty imperial complex, closely connected with the history of Hue.',
      zh: '阮朝的宫廷建筑群，与顺化古都的历史密切相关。',
    },
    latitude: 16.4690,
    longitude: 107.5788,
    radiusMeters: 120,
    priority: 10,
    images: [],
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=16.4690,107.5788',
    ttsScript: {
      vi: 'Đại Nội Huế là một phần quan trọng của quần thể di tích Cố đô Huế.',
      en: 'Hue Imperial City is a central part of the Complex of Hue Monuments.',
      zh: '顺化皇城是顺化古迹群的重要组成部分。',
    },
  },
  {
    id: 'saigon-ben-thanh',
    name: {
      vi: 'Chợ Bến Thành',
      en: 'Ben Thanh Market',
      zh: '滨城市场',
    },
    description: {
      vi: 'Một biểu tượng thương mại và đời sống đô thị của Thành phố Hồ Chí Minh.',
      en: 'An iconic market representing the commercial and urban life of Ho Chi Minh City.',
      zh: '胡志明市具有代表性的市场，展现当地商业与城市生活。',
    },
    latitude: 10.7721,
    longitude: 106.6983,
    radiusMeters: 90,
    priority: 8,
    images: [],
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=10.7721,106.6983',
    ttsScript: {
      vi: 'Chợ Bến Thành là một trong những địa điểm quen thuộc tại trung tâm Thành phố Hồ Chí Minh.',
      en: 'Ben Thanh Market is one of the most recognizable places in central Ho Chi Minh City.',
      zh: '滨城市场是胡志明市中心最具代表性的地点之一。',
    },
  },
];
