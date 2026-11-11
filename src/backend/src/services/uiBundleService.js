// UI bundles (lane 2): namespace `public-ui`.
// - The 5 top-level languages (en, vi, zh, ja, ko) are static JSON files in src/ui_bundles/<namespace>/<locale>.json;
//   English is the source of truth.
// - Any other locale (long tail) is served as the English bundle with `status: "pending"` and `source_hash`
//   (hash of the English source) while the server translates it in the background; the finished translation is
//   stored in MongoDB (`ui_bundles`) and served with `status: "ready"` from then on. A translation made from an
//   older English source is not served (hash differs).
// - `status: "failed"`: the translation failed; English is served and a new attempt is made after
//   UI_BUNDLE_FAILURE_COOLDOWN_SECONDS.
// Redis keys (so several processes do not translate the same locale twice):
//   ui:lock:<ns>:<locale>   translation queued/running
//   ui:fail:<ns>:<locale>   last attempt failed (cooldown)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RateLimited, TtsError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import * as rateLimiter from './rateLimiter.js';
import { uiBundleStore } from '../stores/index.js';

export const NAMESPACE = 'public-ui';
export const SOURCE_LOCALE = 'en';
export const STATIC_LOCALES = ['en', 'vi', 'zh', 'ja', 'ko'];
export const BUNDLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui_bundles');
const LOCALE_RE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$/;
export const BATCH_SIZE = 25;
const PLACEHOLDER_RE = /\{[A-Za-z_]+\}/g; // {count}, {poiName}, ... must survive translation

/** Default batch translator (Google Translate via `google-translate-api-x`), imported lazily. */
export class GoogleBatchTranslator {
  async translateBatch(texts, source, target) {
    let mod;
    try {
      mod = await import('google-translate-api-x');
    } catch {
      throw new TtsError('google-translate-api-x is not installed');
    }
    const translate = mod.default ?? mod.translate;
    const results = await translate(texts, { from: source, to: target });
    return (Array.isArray(results) ? results : [results]).map((r) => r.text);
  }
}

/** 'ja-JP' / 'ja_jp' -> 'ja'. Throws RangeError for something that is not a locale tag. */
export function normalizeLocale(locale) {
  const value = (locale || '').trim();
  if (!LOCALE_RE.test(value)) throw new RangeError(`'${locale}' is not a valid locale`);
  return value.replace(/_/g, '-').split('-')[0].toLowerCase();
}

const staticCache = new Map();
export function loadStatic(namespace, locale) {
  const key = `${namespace}/${locale}`;
  if (!staticCache.has(key)) {
    staticCache.set(key, JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, namespace, `${locale}.json`), 'utf8')));
  }
  return staticCache.get(key);
}

export const sourceStrings = (namespace = NAMESPACE) => loadStatic(namespace, SOURCE_LOCALE);

const hashCache = new Map();
export function sourceHash(namespace = NAMESPACE) {
  if (!hashCache.has(namespace)) {
    const src = sourceStrings(namespace);
    // canonical JSON: sorted keys, compact separators, non-ASCII kept (same as Python's sort_keys/ensure_ascii=False)
    const canonical = JSON.stringify(Object.fromEntries(Object.keys(src).sort().map((k) => [k, src[k]])));
    hashCache.set(namespace, crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16));
  }
  return hashCache.get(namespace);
}

export const makeEtag = (namespace, locale, status, hash) => `W/"ui-${namespace}-${locale}-${status}-${hash}"`;

function bodyOf(namespace, locale, requested, status, strings, fallbackLocale = null) {
  return {
    namespace,
    locale,
    requested_locale: requested,
    status,
    source_hash: sourceHash(namespace),
    fallback_locale: fallbackLocale,
    strings,
  };
}

const lockKey = (namespace, locale) => `ui:lock:${namespace}:${locale}`;
const failKey = (namespace, locale) => `ui:fail:${namespace}:${locale}`;

async function redisExists(redis, key) {
  if (!redis) return false;
  try {
    return Boolean(await redis.exists(key));
  } catch (err) {
    logger.warn(`Redis unavailable (${err.message})`);
    return false;
  }
}

/**
 * Return { body, retryAfter }. `retryAfter` is set when the client should poll again later after being held
 * back by the limiter.
 */
export async function getBundle(db, redis, settings, hydrator, locale, { client = '-', namespace = NAMESPACE } = {}) {
  const requested = locale;
  const base = normalizeLocale(locale);

  if (STATIC_LOCALES.includes(base)) {
    return { body: bodyOf(namespace, base, requested, 'ready', loadStatic(namespace, base)), retryAfter: null };
  }

  const hash = sourceHash(namespace);
  const stored = await uiBundleStore.get(db, namespace, base);
  if (stored && stored.source_hash === hash) {
    return { body: bodyOf(namespace, base, requested, 'ready', stored.strings), retryAfter: null };
  }

  const english = loadStatic(namespace, SOURCE_LOCALE);
  if (await redisExists(redis, lockKey(namespace, base))) {
    return { body: bodyOf(namespace, base, requested, 'pending', english, SOURCE_LOCALE), retryAfter: null };
  }
  if (await redisExists(redis, failKey(namespace, base))) {
    return { body: bodyOf(namespace, base, requested, 'failed', english, SOURCE_LOCALE), retryAfter: null };
  }

  // Nobody is translating this locale yet: start it (limited per client).
  try {
    await rateLimiter.check(redis, 'ui-bundle', client, {
      limit: settings.localizationRateLimitRequests,
      windowSeconds: settings.localizationRateLimitWindowSeconds,
    });
  } catch (err) {
    if (!(err instanceof RateLimited)) throw err;
    return { body: bodyOf(namespace, base, requested, 'pending', english, SOURCE_LOCALE), retryAfter: err.retryAfter };
  }

  const started = await startTranslation(redis, settings, hydrator, namespace, base);
  return {
    body: bodyOf(namespace, base, requested, started ? 'pending' : 'failed', english, SOURCE_LOCALE),
    retryAfter: null,
  };
}

async function startTranslation(redis, settings, hydrator, namespace, locale) {
  if (redis) {
    try {
      if (!(await redis.set(lockKey(namespace, locale), '1', { EX: settings.uiBundleLockSeconds, NX: true }))) {
        return true; // another process just started it
      }
    } catch (err) {
      logger.warn(`Redis unavailable (${err.message}): translating without a cross-process lock`);
    }
  }
  if (hydrator.enqueueUi(namespace, locale) === 'full') {
    await release(redis, namespace, locale);
    return false;
  }
  return true;
}

async function release(redis, namespace, locale) {
  if (!redis) return;
  try {
    await redis.del(lockKey(namespace, locale));
  } catch (err) {
    logger.warn(`Cannot release UI bundle lock: ${err.message}`);
  }
}

const placeholders = (text) => new Set(text.match(PLACEHOLDER_RE) ?? []);
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function withTimeout(promise, seconds) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), seconds * 1000); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Background job: translate the English source into `locale` and store it. */
export async function translateBundle(db, redis, settings, translator, namespace, locale) {
  const english = sourceStrings(namespace);
  const keys = Object.keys(english);
  try {
    const out = [];
    for (let start = 0; start < keys.length; start += BATCH_SIZE) {
      const chunk = keys.slice(start, start + BATCH_SIZE).map((k) => english[k]);
      const part = await withTimeout(
        Promise.resolve(translator.translateBatch(chunk, SOURCE_LOCALE, locale)), settings.ttsTimeoutSeconds,
      );
      if (!Array.isArray(part) || part.length !== chunk.length || part.some((t) => !(t || '').trim())) {
        throw new TtsError('Translation returned incomplete results');
      }
      out.push(...part);
    }
    const strings = {};
    keys.forEach((key, i) => {
      // A translation that lost or changed a {placeholder} is unusable: keep the English text.
      strings[key] = sameSet(placeholders(english[key]), placeholders(out[i])) ? out[i] : english[key];
    });
    await uiBundleStore.upsert(db, {
      namespace, locale, sourceHash: sourceHash(namespace), strings, now: new Date(),
    });
    logger.info(`UI bundle ${namespace}/${locale} translated`);
  } catch (err) {
    logger.warn(`UI bundle ${namespace}/${locale} translation failed: ${err.message}`);
    if (redis) {
      try {
        await redis.set(failKey(namespace, locale), '1', { EX: settings.uiBundleFailureCooldownSeconds });
      } catch { /* ignore */ }
    }
  } finally {
    await release(redis, namespace, locale);
  }
}
