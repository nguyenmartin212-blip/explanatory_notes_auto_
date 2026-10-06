import type { LocalizedText } from '@/types';

export type Poi = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority: number;
  images: string[];
  audio?: Partial<Record<'vi' | 'en' | 'zh' | 'ko', string>>;
  ttsScript?: LocalizedText;
};
