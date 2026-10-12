import { narrationForPoi, supportedNarrationLanguage } from '../src/features/narration/services/narration-content';
import type { Poi } from '../src/features/poi/types';

const poi: Poi = {
  id: 'test',
  name: { vi: 'Địa điểm', en: 'Place', zh: '地点' },
  description: { vi: 'Mô tả', en: 'Description', zh: '说明' },
  latitude: 10,
  longitude: 106,
  radiusMeters: 100,
  priority: 1,
  images: [],
  ttsScript: { vi: 'Lời dẫn', en: 'English script' },
};

describe('narrationForPoi', () => {
  it('uses selected language for TTS', () => {
    expect(narrationForPoi(poi, 'en')).toMatchObject({ source: 'tts', text: 'English script', language: 'en' });
  });
  it('uses description in same language when no script exists', () => {
    expect(narrationForPoi(poi, 'zh')).toMatchObject({ source: 'tts', text: '说明', language: 'zh' });
  });
  it('prefers recorded audio when present', () => {
    const withAudio: Poi = { ...poi, audio: { vi: 'https://example.org/test.mp3' } };
    expect(narrationForPoi(withAudio, 'vi')).toMatchObject({ source: 'audio-file', uri: 'https://example.org/test.mp3' });
  });
  it('does not substitute a Vietnamese script for another language', () => {
    const onlyVi: Poi = { ...poi, description: { vi: 'Chỉ tiếng Việt' }, ttsScript: { vi: 'Tiếng Việt' } };
    expect(narrationForPoi(onlyVi, 'en')).toBeNull();
  });
  it('recognizes the three demo languages', () => {
    expect(supportedNarrationLanguage('ko')).toBe(false);
    expect(supportedNarrationLanguage('vi')).toBe(true);
  });
});
