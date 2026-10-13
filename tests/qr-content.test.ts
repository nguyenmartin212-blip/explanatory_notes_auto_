import { buildPoiQrValue, parsePoiQr } from '../src/features/qr/services/qr-content';

describe('QR content parser', () => {
  it('parses Go to Horizon deep-link QR', () => {
    expect(parsePoiQr('gotohorizon://poi/hanoi-thang-long')).toEqual({
      kind: 'poi', poiId: 'hanoi-thang-long',
    });
  });

  it('parses web-compatible story links', () => {
    expect(parsePoiQr('https://example.com/?story=hanoi-thang-long')?.poiId)
      .toBe('hanoi-thang-long');
  });

  it('parses compact QR payload', () => {
    expect(parsePoiQr('GTH:POI:hanoi-thang-long')?.poiId).toBe('hanoi-thang-long');
  });

  it('rejects malformed values', () => {
    expect(parsePoiQr('%%% not a poi %%%')).toBeNull();
  });

  it('builds a canonical payload', () => {
    expect(buildPoiQrValue('hanoi-thang-long')).toBe('gotohorizon://poi/hanoi-thang-long');
  });
});
