export type PoiContent = {
  name: string;
  description: string;
  audio_url: string | null;
  lang: string;
  is_fallback: boolean;
};

export type Poi = {
  id: string;
  backendId: number;
  regionCode: string;
  content: PoiContent;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority: number;
  images: string[];
};
