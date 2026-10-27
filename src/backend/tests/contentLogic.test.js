// Pure-logic tests for Chapter 05 (run with: npm test)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/core/errors.js';
import { DEFAULT_RADIUS_METERS, parsePoiCreate, parsePoiUpdate } from '../src/schemas/content.js';
import {
  computeContentHash, fallbackChain, hasValidAudio, narrationText, resolveContent,
} from '../src/services/localizationFallback.js';
import { decodeCursor, encodeCursor, etagMatches, makeEtag } from '../src/services/poiSync.js';
import { haversineM } from '../src/utils/geo.js';

const loc = (name = 'N', description = 'D', extra = {}) => ({ name, description, ...extra });

describe('haversine', () => {
  it('zero distance', () => assert.equal(haversineM(21.0, 105.8, 21.0, 105.8), 0));
  it('Hanoi to Ho Chi Minh City', () => {
    const d = haversineM(21.0353, 105.8402, 10.7721, 106.6983);
    assert.ok(d > 1_100_000 && d < 1_200_000, String(d));
  });
  it('one degree of latitude', () => {
    assert.ok(Math.abs(haversineM(0, 0, 1, 0) - 111_195) < 300);
  });
});

describe('fallback', () => {
  it('chain order', () => {
    assert.deepEqual(fallbackChain('zh'), ['zh', 'en', 'vi']);
    assert.deepEqual(fallbackChain('en'), ['en', 'vi']);
    assert.deepEqual(fallbackChain('vi'), ['vi', 'en']);
    assert.deepEqual(fallbackChain(null), ['en', 'vi']);
  });

  it('requested language wins', () => {
    const r = resolveContent({ zh: loc('中'), en: loc('EN'), vi: loc('VI') }, 'zh');
    assert.deepEqual([r.language_served, r.name, r.fallback], ['zh', '中', false]);
  });

  it('falls back to English then Vietnamese', () => {
    let r = resolveContent({ en: loc('EN'), vi: loc('VI') }, 'ko');
    assert.deepEqual([r.language_served, r.fallback], ['en', true]);
    r = resolveContent({ vi: loc('VI') }, 'ko');
    assert.equal(r.language_served, 'vi');
  });

  it('unusable localization is skipped', () => {
    // English has a name but no description -> not usable -> Vietnamese
    const r = resolveContent({ en: loc('EN', ''), vi: loc('VI') }, 'zh');
    assert.equal(r.language_served, 'vi');
    assert.equal(resolveContent({ en: loc('EN', '') }, 'zh'), null);
    assert.equal(resolveContent({}, 'en'), null);
  });

  it('narration text prefers tts_script', () => {
    assert.equal(narrationText({ tts_script: ' script ', description: 'd' }), 'script');
    assert.equal(narrationText({ tts_script: '  ', description: ' d ' }), 'd');
    assert.equal(narrationText({}), '');
  });

  it('audio is valid only for the current text', () => {
    const h = computeContentHash('en', 'text');
    const ok = { audio_status: 'ready', audio_url: 'u', audio_hash: h, content_hash: h };
    assert.equal(hasValidAudio(ok), true);
    assert.equal(hasValidAudio({ ...ok, content_hash: 'other' }), false);
    assert.equal(hasValidAudio({ ...ok, audio_status: 'pending' }), false);
    assert.equal(hasValidAudio({ ...ok, audio_url: null }), false);
    assert.notEqual(computeContentHash('en', 'x'), computeContentHash('vi', 'x'));
  });

  it('public audio url hidden when stale', () => {
    const h = computeContentHash('en', 't');
    const stale = loc('EN', 'D', { audio_status: 'ready', audio_url: 'u', audio_hash: 'old', content_hash: h });
    assert.equal(resolveContent({ en: stale }, 'en').audio_url, null);
  });

  it('content hash is the same as the Python version (sha256 of "<lang>\\n<text>")', () => {
    // python: hashlib.sha256("en\nhello".encode()).hexdigest()
    assert.equal(computeContentHash('en', 'hello'), 'd932d472153d3fbddefea65d6ea88ba29e8bc20e4f339ae791e3881b793a5113');
  });
});

describe('sync helpers', () => {
  it('cursor round trip', () => {
    for (const v of [0, 1, 12345]) assert.equal(decodeCursor(encodeCursor(v)), v);
  });

  it('invalid cursors', () => {
    const b64 = (s) => Buffer.from(s).toString('base64url');
    for (const token of [null, '', 'abc', '!!!', b64('{"c":1,"v":-3}'), b64('{"c":9,"v":3}')]) {
      assert.equal(decodeCursor(token), null, String(token));
    }
  });

  it('cursor is compatible with the Python encoding', () => {
    // python: base64.urlsafe_b64encode(b'{"c":1,"v":7}').decode().rstrip("=")
    assert.equal(encodeCursor(7), Buffer.from('{"c":1,"v":7}').toString('base64url'));
    assert.equal(decodeCursor(`${encodeCursor(7)}==`), 7); // padded tokens are accepted too
  });

  it('etag matching', () => {
    const etag = makeEtag(7, 'vi');
    assert.equal(etag, 'W/"7-vi"');
    assert.equal(etagMatches('W/"7-vi"', etag), true);
    assert.equal(etagMatches('"7-vi"', etag), true);
    assert.equal(etagMatches('"1-vi", W/"7-vi"', etag), true);
    assert.equal(etagMatches('*', etag), true);
    assert.equal(etagMatches('W/"6-vi"', etag), false);
    assert.equal(etagMatches('W/"7-en"', etag), false);
    assert.equal(etagMatches(null, etag), false);
    assert.equal(makeEtag(0, null), 'W/"0-all"');
  });
});

describe('schemas', () => {
  it('default radius matches the FE', () => {
    // FE: DEFAULT_GEOFENCE_RADIUS_METERS (src/constants/app.ts)
    assert.equal(DEFAULT_RADIUS_METERS, 80);
    assert.equal(parsePoiCreate({ latitude: 21.0, longitude: 105.8 }).radius_meters, 80);
  });

  it('rejects bad input', () => {
    assert.throws(() => parsePoiCreate({ latitude: 91, longitude: 0 }), ValidationError);
    assert.throws(() => parsePoiCreate({ latitude: 0, longitude: 0, poi_id: 'Bad Id' }), ValidationError);
    assert.throws(() => parsePoiCreate({ latitude: 0, longitude: 0, localizations: { fr: { name: 'x' } } }), ValidationError);
    assert.throws(() => parsePoiCreate({ latitude: 0, longitude: 0, localizations: { en: { name: '' } } }), ValidationError);
    assert.throws(() => parsePoiCreate('nope'), ValidationError);
  });

  it('update only tracks sent fields', () => {
    const { data, sent } = parsePoiUpdate({ radius_meters: 50 });
    assert.deepEqual([...sent], ['radius_meters']);
    assert.equal(data.latitude, null);
  });
});
