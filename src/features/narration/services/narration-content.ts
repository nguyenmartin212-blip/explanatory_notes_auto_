import type { Poi } from '@/features/poi';
import type { SupportedLanguage } from '@/types';
import type { NarrationItem } from '../types';

export type NarrationLanguage = SupportedLanguage;

export const NARRATION_LOCALES: Record<NarrationLanguage, string> = {
  vi: 'vi-VN',
  en: 'en-US',
  zh: 'zh-CN',
  ko: 'ko-KR',
};

/** Use only text in the selected language: never read Vietnamese with an English voice. */
export function narrationForPoi(
  poi: Poi,
  language: NarrationLanguage,
): NarrationItem | null {
  const uri = poi.audio?.[language]?.trim();
  if (uri) return { poiId: poi.id, language, source: 'audio-file', uri };

  const text = poi.ttsScript?.[language]?.trim() || poi.description[language]?.trim();
  if (text) return { poiId: poi.id, language, source: 'tts', text };
  return null;
}

export function supportedNarrationLanguage(value: SupportedLanguage): value is NarrationLanguage {
  return value === 'vi' || value === 'en' || value === 'zh' || value === 'ko';
}
