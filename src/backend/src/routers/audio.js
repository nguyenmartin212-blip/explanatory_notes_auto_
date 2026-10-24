// Mounted at /audio
import fs from 'node:fs';
import { Router } from 'express';
import { HttpError, queryEnum, header, settingsOf, stateOf, wrap } from '../core/http.js';
import { TtsError } from '../core/errors.js';
import { parseTtsRequest } from '../schemas/audio.js';
import { SUPPORTED_LANGUAGES } from '../schemas/content.js';
import * as audioPack from '../services/audioPack.js';
import { etagMatches } from '../services/poiSync.js';

export const router = Router();

/**
 * Create (or reuse from cache) the MP3 for `text` in `lang` and stream it. The text is translated first when
 * `source_lang` differs from `lang`.
 */
router.post('/tts', wrap(async (req, res) => {
  const body = parseTtsRequest(req.body);
  const maxChars = settingsOf(req).ttsMaxTextChars;
  if ([...body.text].length > maxChars) throw new HttpError(422, `text is longer than ${maxChars} characters`);
  let result;
  try {
    result = await stateOf(req).tts.generate(body.text, body.lang, body.source_lang);
  } catch (err) {
    if (err instanceof RangeError) throw new HttpError(422, err.message);
    if (err instanceof TtsError) throw new HttpError(502, err.message);
    throw err;
  }
  const size = (await fs.promises.stat(result.cachePath)).size;
  res.status(200).set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(size),
    'X-Audio-Cache': result.cacheHit ? 'hit' : 'miss',
    'X-Audio-Cache-Key': result.cacheKey,
  });
  await new Promise((resolve, reject) => {
    const file = fs.createReadStream(result.cachePath);
    file.on('error', reject);
    res.on('close', resolve);
    file.pipe(res);
  });
}));

/** Audio files of public POIs: url, size, SHA-256 and the pack version. */
router.get('/pack-manifest', wrap(async (req, res) => {
  const lang = queryEnum(req, 'lang', SUPPORTED_LANGUAGES);
  const manifest = await audioPack.buildManifest(stateOf(req).db, { lang });
  const etag = audioPack.makePackEtag(manifest.pack_version);
  res.set({ ETag: etag, 'Cache-Control': 'no-cache' });
  if (etagMatches(header(req, 'if-none-match'), etag)) return res.status(304).end();
  return res.json(manifest);
}));
