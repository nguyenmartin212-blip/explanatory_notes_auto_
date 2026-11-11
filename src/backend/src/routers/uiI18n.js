// Mounted at /api/v1/ui-bundles
import { Router } from 'express';
import { HttpError } from '../core/errors.js';
import { clientOf, header, settingsOf, stateOf, wrap } from '../core/http.js';
import { etagMatches } from '../services/poiSync.js';
import * as uiBundleService from '../services/uiBundleService.js';

export const router = Router();

/**
 * Namespace `public-ui`. en/vi/zh/ja/ko are static; any other locale returns the English fallback with
 * `status: "pending"` (+ `source_hash`) while it is translated.
 */
router.get('/:locale', wrap(async (req, res) => {
  const state = stateOf(req);
  let result;
  try {
    result = await uiBundleService.getBundle(state.db, state.redis, settingsOf(req), state.localization, req.params.locale, {
      client: clientOf(req),
    });
  } catch (err) {
    if (err instanceof RangeError) throw new HttpError(422, err.message);
    throw err;
  }
  const { body, retryAfter } = result;
  const headers = { 'Cache-Control': 'no-cache' };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  if (body.status === 'ready') {
    const etag = uiBundleService.makeEtag(body.namespace, body.locale, 'ready', body.source_hash);
    headers.ETag = etag;
    if (etagMatches(header(req, 'if-none-match'), etag)) return res.status(304).set(headers).end();
  }
  return res.set(headers).json(body);
}));
