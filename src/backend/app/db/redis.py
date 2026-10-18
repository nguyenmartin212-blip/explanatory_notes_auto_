"""Step 2b — Redis connection."""

from redis.asyncio import Redis

from app.core.config import Settings
from app.core.errors import StartupError


async def connect_redis(settings: Settings) -> Redis:
    client = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await client.ping()
    except Exception as exc:
        await client.aclose()
        raise StartupError(f"Cannot connect to Redis: {exc}") from exc
    return client
