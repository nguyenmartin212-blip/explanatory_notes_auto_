import { mockPois } from '@/features/poi';
import { getOfflineDefenseStatus, installPoiOfflinePack, resolveLocalizedText } from '@/features/content/offline-defense';

jest.mock('@/features/content/database', () => ({
  getOfflinePois: jest.fn(async () => []),
  replaceOfflinePois: jest.fn(async () => undefined),
}));

describe('offline defense', () => {
  it('uses target language then English then Vietnamese fallback', () => {
    expect(resolveLocalizedText({ vi: 'Xin chào', en: 'Hello' }, 'zh')).toBe('Hello');
    expect(resolveLocalizedText({ vi: 'Xin chào' }, 'ko')).toBe('Xin chào');
    expect(resolveLocalizedText({ vi: 'Xin chào', en: 'Hello', zh: '你好' }, 'zh')).toBe('你好');
  });

  it('exposes the expected bounded offline cache policy', () => {
    const status = getOfflineDefenseStatus();
    expect(status.networkStrategy).toBe('NetworkFirst');
    expect(status.networkTimeoutMs).toBe(8000);
    expect(status.maxPoisPerSnapshot).toBe(300);
    expect(status.maxConcurrentLanguageShards).toBe(3);
  });

  it('installs a valid POI pack transactionally through SQLite storage', async () => {
    const result = await installPoiOfflinePack({ id: 'demo-pack', pois: mockPois });
    expect(result.packId).toBe('demo-pack');
    expect(result.poiCount).toBe(mockPois.length);
  });

  it('rejects a pack with duplicate POI ids', async () => {
    await expect(installPoiOfflinePack({ id: 'bad', pois: [mockPois[0]!, mockPois[0]!] }))
      .rejects.toThrow('duplicate POI id');
  });
});
