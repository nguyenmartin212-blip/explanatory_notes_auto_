// Fixed-window limiter on Redis. When it blocks, the caller gets RateLimited(retryAfter) and the HTTP layer
// answers 429 with a Retry-After header. If Redis cannot be reached the limiter lets the request through
// (fail open): unlike authentication, a limiter outage must not take the public API down.
import { RateLimited } from '../core/errors.js';
import { logger } from '../core/logger.js';

/** Count one request of `client` in `scope`; throw RateLimited when over `limit`. */
export async function check(redis, scope, client, { limit, windowSeconds }) {
  if (!redis || limit <= 0) return;
  const key = `rl:${scope}:${client}`;
  let count;
  let ttl;
  try {
    count = await redis.incr(key);
    ttl = await redis.ttl(key);
    if (count === 1 || ttl === null || ttl === undefined || ttl < 0) {
      await redis.expire(key, windowSeconds); // first hit, or a key left without expiry
      ttl = windowSeconds;
    }
  } catch (err) {
    logger.warn(`Rate limiter unavailable (${err.message}): letting the request through`);
    return;
  }
  if (count > limit) throw new RateLimited(ttl);
}

/** Allow one call per `seconds` for `scope` (all clients); otherwise RateLimited. */
export async function cooldown(redis, scope, { seconds }) {
  if (!redis || seconds <= 0) return;
  const key = `cd:${scope}`;
  let ttl;
  try {
    if (await redis.set(key, '1', { EX: seconds, NX: true })) return;
    ttl = await redis.ttl(key);
  } catch (err) {
    logger.warn(`Cooldown unavailable (${err.message}): letting the request through`);
    return;
  }
  throw new RateLimited(ttl && ttl > 0 ? ttl : seconds);
}
