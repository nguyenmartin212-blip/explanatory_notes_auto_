// Paths of Chapter 08: /localizations/prepare-hotset, /localizations/on-demand, /localizations/warmup (and /warmup).
import { Router } from 'express';
import { HttpError } from '../core/errors.js';
import { clientOf, settingsOf, stateOf, wrap } from '../core/http.js';
import { NotFoundError, TtsError } from '../core/errors.js';
import { parseHotsetRequest, parseOnDemandRequest, parseWarmupRequest } from '../schemas/localization.js';
import * as localizationService from '../services/localizationService.js';

export const router = Router();

const deps = (req) => {
  const state = stateOf(req);
  return [state.db, state.redis, settingsOf(req), state.localization];
};

/** Warm up to 10 POIs within 1.5 km. `ready` is true when the 3 required POIs have content and audio in `lang`. */
router.post('/localizations/prepare-hotset', wrap(async (req, res) => {
  const body = parseHotsetRequest(req.body);
  res.json(await localizationService.prepareHotset(...deps(req), { lat: body.lat, lng: body.lng, lang: body.lang, client: clientOf(req) }));
}));

/** Reactive: hydrate one POI in `lang` now. */
router.post('/localizations/on-demand', wrap(async (req, res) => {
  const body = parseOnDemandRequest(req.body);
  try {
    res.json(await localizationService.onDemand(...deps(req), { poiId: body.poi_id, lang: body.lang, client: clientOf(req) }));
  } catch (err) {
    if (err instanceof NotFoundError) throw new HttpError(404, err.message);
    if (err instanceof TtsError) throw new HttpError(502, err.message);
    throw err;
  }
}));

/** Full-corpus hydration in the background. */
const warmup = wrap(async (req, res) => {
  const body = parseWarmupRequest(req.body);
  res.status(202).json(await localizationService.warmup(...deps(req), { lang: body.lang, client: clientOf(req) }));
});
router.post('/localizations/warmup', warmup);
router.post('/warmup', warmup);
