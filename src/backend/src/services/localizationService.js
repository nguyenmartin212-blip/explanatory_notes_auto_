// Content locale lane (Chapter 08).
// Hydration = make sure a POI has usable content (and audio) in the target language, translating it from the
// best available source: target -> English -> Vietnamese. Human-written content is never overwritten; a
// machine translation is redone only when the source text it came from has changed.
//   prepareHotset  up to 10 nearest POIs within 1.5 km; the 3 nearest are `required` and the switch is `ready`
//                  only when all of them have content AND audio
//   onDemand       reactive: hydrate one POI now
//   warmup         background: hydrate the whole public corpus
// Work runs through LocalizationHydrator, an in-process priority queue with a bounded number of translations
// at once. Queue full / no free slot -> RateLimited(Retry-After).
import { NotFoundError, RateLimited } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { SUPPORTED_LANGUAGES } from '../schemas/content.js';
import * as contentService from './contentService.js';
import { fallbackChain, hasValidAudio, isUsable, resolveContent } from './localizationFallback.js';
import { findCandidates } from './poiNearby.js';
import * as rateLimiter from './rateLimiter.js';
import * as uiBundleService from './uiBundleService.js';
import { poiLocalizationStore, poiStore } from '../stores/index.js';
import { Semaphore } from '../utils/semaphore.js';

export const PRIORITY_REQUIRED = 0;
export const PRIORITY_HOTSET = 1;
export const PRIORITY_WARMUP = 2;

// ---- Pure rules ----------------------------------------------------------------------------------
/** Best source to translate from: English, else Vietnamese (never the target itself) -> [language, loc] | null. */
export function pickSource(locs, target) {
  for (const language of fallbackChain(target)) {
    if (language !== target && isUsable(locs[language])) return [language, locs[language]];
  }
  return null;
}

export function needsTranslation(targetLoc, source) {
  if (!source) return false;
  if (!isUsable(targetLoc)) return true;
  // A machine translation whose source text has changed is outdated.
  return Boolean(targetLoc.machine_translated && targetLoc.source_content_hash !== source.content_hash);
}

export function poiState(locs, lang, failure = null) {
  const target = locs[lang];
  const picked = pickSource(locs, lang);
  const source = picked ? picked[1] : null;
  const contentReady = isUsable(target) && !needsTranslation(target, source);
  const audioReady = contentReady && hasValidAudio(target);
  let state;
  if (audioReady) state = 'ready';
  else if (!contentReady && source === null) state = 'no_source'; // nothing to translate from: served with fallback
  else if (failure) state = 'failed';
  else state = 'pending';
  const out = { content_ready: contentReady, audio_ready: audioReady, state };
  if (failure && state === 'failed') out.error = failure;
  return out;
}

const clip = (value, limit) => (value ? [...value].slice(0, limit).join('') : value);

export function checkLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    throw new RangeError(`Unsupported language '${lang}'; supported: ${JSON.stringify(SUPPORTED_LANGUAGES)}`);
  }
}

// ---- Hydrator (queue + workers) ------------------------------------------------------------------
export class LocalizationHydrator {
  constructor(db, settings, tts, { redis = null, uiTranslator = null, clock = () => performance.now() / 1000 } = {}) {
    this.db = db;
    this.settings = settings;
    this.tts = tts;
    this.redis = redis;
    this.uiTranslator = uiTranslator || new uiBundleService.GoogleBatchTranslator();
    this.clock = clock;
    this.concurrency = Math.max(Number(settings.localizationTranslateConcurrency), 1);
    this.queueMax = Number(settings.localizationQueueMax);
    this.failureCooldown = Number(settings.localizationFailureCooldownSeconds);
    this.heap = []; // sorted by [priority, seq]
    this.seq = 0;
    this.queued = new Set(); // string keys
    this.active = new Set();
    this.sem = new Semaphore(this.concurrency);
    this.failures = new Map(); // "poi_id|lang" -> [expiresAt, message]
    this.waiters = [];
  }

  // ---- queue ----------------------------------------------------------------------------------
  get pendingCount() { return this.queued.size; }

  enqueueKey(key, item, priority) {
    if (this.queued.has(key) || this.active.has(key)) return 'duplicate';
    if (this.queued.size >= this.queueMax) return 'full';
    this.queued.add(key);
    const entry = { priority, seq: this.seq++, key, item };
    let i = this.heap.length;
    while (i > 0 && (this.heap[i - 1].priority > priority)) i -= 1; // stable: equal priority keeps FIFO
    this.heap.splice(i, 0, entry);
    this.notify();
    return 'queued';
  }

  notify() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** 'queued' | 'duplicate' | 'full' | 'cooldown' (it failed a moment ago). */
  enqueuePoi(poiId, lang, priority = PRIORITY_HOTSET) {
    if (this.failure(poiId, lang)) return 'cooldown';
    return this.enqueueKey(`poi|${poiId}|${lang}`, { kind: 'poi', poiId, lang }, priority);
  }

  enqueueUi(namespace, locale) {
    return this.enqueueKey(`ui|${namespace}|${locale}`, { kind: 'ui', namespace, locale }, PRIORITY_HOTSET);
  }

  failure(poiId, lang) {
    const key = `${poiId}|${lang}`;
    const item = this.failures.get(key);
    if (!item) return null;
    if (item[0] <= this.clock()) {
      this.failures.delete(key);
      return null;
    }
    return item[1];
  }

  /** Rough wait until a full queue has room again. */
  retryAfterHint() {
    return Math.max(Math.trunc(this.pendingCount / this.concurrency) + 1, 5);
  }

  /** Worker loop; run it as a background worker (stops when `signal` is aborted). */
  async run(signal) {
    await Promise.all(Array.from({ length: this.concurrency }, () => this.consume(signal)));
  }

  waitForWork(signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => { signal?.removeEventListener('abort', done); resolve(); };
      signal?.addEventListener('abort', done, { once: true });
      this.waiters.push(done);
    });
  }

  async consume(signal) {
    while (!signal?.aborted) {
      if (!this.heap.length) {
        await this.waitForWork(signal);
        continue;
      }
      const { key, item } = this.heap.shift();
      this.queued.delete(key);
      this.active.add(key);
      try {
        if (item.kind === 'poi') {
          await this.hydrateGuarded(item.poiId, item.lang);
        } else {
          await uiBundleService.translateBundle(this.db, this.redis, this.settings, this.uiTranslator, item.namespace, item.locale);
        }
      } catch (err) {
        logger.exception(`Localization job ${key} failed`, err);
      } finally {
        this.active.delete(key);
      }
    }
  }

  // ---- hydration ------------------------------------------------------------------------------
  async hydrateGuarded(poiId, lang) {
    await this.sem.acquire();
    try {
      return await hydratePoi(this.db, this.settings, this.tts, poiId, lang);
    } catch (err) {
      if (err instanceof NotFoundError) return null; // deleted meanwhile
      const message = String(err.message || '').slice(0, 300) || err.constructor.name;
      logger.warn(`Hydration of ${poiId}/${lang} failed: ${message}`);
      this.failures.set(`${poiId}|${lang}`, [this.clock() + this.failureCooldown, message]);
      return null;
    } finally {
      this.sem.release();
    }
  }

  /**
   * Reactive hydration (on-demand). Waits for a free slot at most LOCALIZATION_ON_DEMAND_WAIT_SECONDS, then
   * asks the client to retry later.
   */
  async hydrateNow(poiId, lang) {
    const wait = Number(this.settings.localizationOnDemandWaitSeconds);
    if (!(await this.sem.acquire(wait))) throw new RateLimited(this.retryAfterHint(), 'Translation capacity is busy');
    try {
      return await hydratePoi(this.db, this.settings, this.tts, poiId, lang);
    } finally {
      this.sem.release();
    }
  }
}

/** Returns 'translated' | 'present' | 'no_source'. Throws NotFoundError / TtsError. */
export async function hydratePoi(db, settings, tts, poiId, lang) {
  checkLanguage(lang);
  const poi = await poiStore.get(db, poiId);
  if (!poi || poi.status !== poiStore.STATUS_ACTIVE) throw new NotFoundError(`POI '${poiId}' not found`);
  const locs = await poiLocalizationStore.listForPoi(db, poiId);
  const picked = pickSource(locs, lang);
  if (picked === null) {
    if (isUsable(locs[lang])) {
      await contentService.ensureAudio(db, poiId, lang);
      return 'present';
    }
    return 'no_source';
  }
  const [sourceLang, source] = picked;

  if (!needsTranslation(locs[lang], source)) {
    await contentService.ensureAudio(db, poiId, lang); // text is fine; make sure audio exists
    return 'present';
  }

  const tr = async (text) => (text && text.trim() ? tts.translate(text, sourceLang, lang) : null);
  const [name, description, script] = await Promise.all([tr(source.name), tr(source.description), tr(source.tts_script)]);
  const data = {
    name: (clip(name, 200) || '').trim(),
    description: (clip(description, 5000) || '').trim(),
    tts_script: clip(script, 5000)?.trim() ?? null,
  };
  if (!data.name) throw new RangeError('Translated name is empty');
  await contentService.saveLocalization(db, settings, poiId, lang, data, {
    machine_translated: true,
    translated_from: sourceLang,
    source_content_hash: source.content_hash ?? null,
  });
  return 'translated';
}

// ---- Endpoints' logic ----------------------------------------------------------------------------
const limitClient = (redis, settings, scope, client) =>
  rateLimiter.check(redis, scope, client, {
    limit: settings.localizationRateLimitRequests,
    windowSeconds: settings.localizationRateLimitWindowSeconds,
  });

/** Warm the nearest POIs for `lang`. Safe to call repeatedly: it reports progress. */
export async function prepareHotset(db, redis, settings, hydrator, { lat, lng, lang, client }) {
  checkLanguage(lang);
  await limitClient(redis, settings, 'hotset', client);

  const radius = Number(settings.localizationHotsetRadiusM);
  const { source, found } = await findCandidates(db, {
    lat, lng, radiusM: radius, limit: Number(settings.localizationHotsetMaxPois),
  });
  const locs = await poiLocalizationStore.listForPois(db, found.map(([p]) => p.poi_id));
  const requiredN = Number(settings.localizationHotsetRequired);

  const items = [];
  let queued = 0;
  let full = false;
  found.forEach(([poi, distance], index) => {
    const poiId = poi.poi_id;
    const required = index < requiredN;
    const state = poiState(locs[poiId] ?? {}, lang, hydrator.failure(poiId, lang));
    if (state.state === 'pending') {
      const outcome = hydrator.enqueuePoi(poiId, lang, required ? PRIORITY_REQUIRED : PRIORITY_HOTSET);
      if (outcome === 'queued') queued += 1;
      full = full || outcome === 'full';
    }
    items.push({ poi_id: poiId, distance_m: Math.round(distance * 10) / 10, required, ...state });
  });
  if (full && !queued) throw new RateLimited(hydrator.retryAfterHint(), 'Translation queue is full');

  // no_source cannot become ready, so it does not hold the switch back
  const ready = items.filter((i) => i.required).every((i) => i.state === 'ready' || i.state === 'no_source');
  return {
    language: lang,
    radius_m: radius,
    max_pois: Number(settings.localizationHotsetMaxPois),
    source,
    required_poi_ids: items.filter((i) => i.required).map((i) => i.poi_id),
    ready,
    count: items.length,
    pois: items,
  };
}

/** Reactive: hydrate one POI now. Audio is generated in the background. */
export async function onDemand(db, redis, settings, hydrator, { poiId, lang, client }) {
  checkLanguage(lang);
  await limitClient(redis, settings, 'on-demand', client);
  const result = await hydrator.hydrateNow(poiId, lang);
  const locs = await poiLocalizationStore.listForPoi(db, poiId);
  return { poi_id: poiId, language: lang, result, ...poiState(locs, lang), content: resolveContent(locs, lang) };
}

/** Queue the whole public corpus (background). One run per language per cooldown. */
export async function warmup(db, redis, settings, hydrator, { lang, client }) {
  const languages = lang ? [lang] : [...SUPPORTED_LANGUAGES];
  languages.forEach(checkLanguage);
  await limitClient(redis, settings, 'warmup', client);
  await rateLimiter.cooldown(redis, `warmup:${lang || 'all'}`, { seconds: Number(settings.localizationWarmupCooldownSeconds) });

  const pois = await poiStore.listActive(db);
  const locs = await poiLocalizationStore.listForPois(db, pois.map((p) => p.poi_id));
  const result = {};
  let queuedTotal = 0;
  let skippedFull = 0;
  const ordered = [...pois].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.poi_id < b.poi_id ? -1 : a.poi_id > b.poi_id ? 1 : 0));
  for (const language of languages) {
    let queued = 0;
    let alreadyOk = 0;
    for (const poi of ordered) {
      const poiId = poi.poi_id;
      if (poiState(locs[poiId] ?? {}, language).state !== 'pending') {
        alreadyOk += 1;
        continue;
      }
      const outcome = hydrator.enqueuePoi(poiId, language, PRIORITY_WARMUP);
      if (outcome === 'queued') queued += 1;
      else if (outcome === 'full') skippedFull += 1;
    }
    result[language] = { queued, already_ok: alreadyOk };
    queuedTotal += queued;
  }
  if (skippedFull && !queuedTotal) throw new RateLimited(hydrator.retryAfterHint(), 'Translation queue is full');
  return { status: 'accepted', total_pois: pois.length, queued: queuedTotal, skipped_queue_full: skippedFull, languages: result };
}
