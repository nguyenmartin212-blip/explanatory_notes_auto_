"""Server-Sent Events stream of audio task progress.

GET /admin/audio-tasks/stream sends:
  event: snapshot   the most recent tasks, once, when the client connects
  event: task       every time a task changes (status, stage or progress)
  : keepalive       a comment line while nothing changes

Changes are read from the database (the `updated_at` of each task), not from
in-process events, so the stream works with several worker processes.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timezone

from app.services.audio_task_manager import task_view
from app.stores import audio_task_store


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def event_stream(
    db,
    *,
    is_disconnected: Callable[[], Awaitable[bool]],
    poll_seconds: float = 1.0,
    keepalive_seconds: float = 15.0,
    snapshot_limit: int = 100,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> AsyncIterator[str]:
    snapshot = await audio_task_store.list_recent(db, snapshot_limit)
    yield format_sse("snapshot", {"tasks": [task_view(t) for t in snapshot]})

    seen: dict[str, datetime] = {t["task_id"]: t["updated_at"] for t in snapshot if t.get("updated_at")}
    cursor = max(seen.values(), default=datetime.now(timezone.utc))
    last_sent = clock()

    while not await is_disconnected():
        await sleep(poll_seconds)
        emitted = False
        for doc in await audio_task_store.list_updated_since(db, cursor):
            updated_at = doc.get("updated_at")
            if updated_at is None or seen.get(doc["task_id"]) == updated_at:
                continue
            seen[doc["task_id"]] = updated_at
            cursor = max(cursor, updated_at)
            emitted = True
            yield format_sse("task", task_view(doc))
        if emitted:
            last_sent = clock()
        elif clock() - last_sent >= keepalive_seconds:
            last_sent = clock()
            yield ": keepalive\n\n"
