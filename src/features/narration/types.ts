export type NarrationSource = 'audio-file' | 'tts';

export type NarrationItem = {
  poiId: string;
  source: NarrationSource;
  uri?: string;
  text?: string;
  language: 'vi' | 'en' | 'zh' | 'ko';
};
