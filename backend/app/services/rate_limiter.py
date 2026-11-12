"""Fixed-window limiter on Redis. When it blocks, the caller gets RateLimited(retry_after)
and the HTTP layer answers 429 with a Retry-After header.

If Redis cannot be reached the limiter lets the request through (fail open):
unlike authentication, a limiter outage must not take the public API down.
"""

from __future__ import annotations

import logging

from app.core.errors import RateLimited

logger = logging.getLogger(__name__)


async def check(redis, scope: str, client: str, *, limit: int, window_seconds: int) -> None:
    """Count one request of `client` in `scope`; raise RateLimited when over `limit`."""
    if redis is None or limit <= 0:
        return
    key = f"rl:{scope}:{client}"
    try:
        count = await redis.incr(key)
        ttl = await redis.ttl(key)
        if count == 1 or ttl is None or ttl < 0:  # first hit, or a key left without expiry
            await redis.expire(key, window_seconds)
            ttl = window_seconds
    except Exception as exc:
        logger.warning("Rate limiter unavailable (%s): letting the request through", exc)
        return
    if count > limit:
        raise RateLimited(ttl)


async def cooldown(redis, scope: str, *, seconds: int) -> None:
    """Allow one call per `seconds` for `scope` (all clients); otherwise RateLimited."""
    if redis is None or seconds <= 0:
        return
    key = f"cd:{scope}"
    try:
        if await redis.set(key, "1", ex=seconds, nx=True):
            return
        ttl = await redis.ttl(key)
    except Exception as exc:
        logger.warning("Cooldown unavailable (%s): letting the request through", exc)
        return
    raise RateLimited(ttl if ttl and ttl > 0 else seconds)
