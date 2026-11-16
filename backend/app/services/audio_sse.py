"""Snapshot, task updates and keepalive events from the Extra branch."""
import asyncio
import json
import time
from datetime import timezone

from starlette.concurrency import run_in_threadpool

from app.stores.audio_task_store import AudioTaskStore, utc_now


def format_sse(event, data):
    if event == "keepalive":
        return ": keepalive\n\n"
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def task_view(doc):
    return {**doc, "updated_at": doc["updated_at"].replace(tzinfo=timezone.utc).isoformat()}


async def event_stream(is_disconnected, poll_seconds=1.0, keepalive_seconds=15.0, snapshot_limit=100):
    def signature(doc):
        return (doc["updated_at"], doc["status"], doc["stage"], doc["progress"], doc["error"])

    cursor = utc_now().replace(microsecond=0)
    snapshot = await run_in_threadpool(AudioTaskStore.list_recent, snapshot_limit)
    seen = {doc["task_id"]: signature(doc) for doc in snapshot}
    yield format_sse("snapshot", {"tasks": [task_view(doc) for doc in snapshot]})
    last_sent = time.monotonic()

    while not await is_disconnected():
        await asyncio.sleep(poll_seconds)
        for doc in await run_in_threadpool(AudioTaskStore.list_updated_since, cursor):
            current = signature(doc)
            cursor = max(cursor, doc["updated_at"])
            if seen.get(doc["task_id"]) == current:
                continue
            seen[doc["task_id"]] = current
            last_sent = time.monotonic()
            yield format_sse("task", task_view(doc))
        seen = {key: value for key, value in seen.items() if value[0] >= cursor}
        if time.monotonic() - last_sent >= keepalive_seconds:
            last_sent = time.monotonic()
            yield format_sse("keepalive", None)
