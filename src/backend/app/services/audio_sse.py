import asyncio
import json
import time
from datetime import datetime
from typing import AsyncGenerator
from app.stores.audio_task_store import AudioTaskStore

def format_sse(event: str, data: dict | str) -> str:
    """Định dạng chuỗi Server-Sent Events chuẩn."""
    payload = json.dumps(data) if isinstance(data, dict) else data
    if event == "keepalive":
        return ": keepalive\n\n"
    return f"event: {event}\ndata: {payload}\n\n"

def task_view(doc: dict) -> dict:
    """Chuyển đổi document database thành dạng view trả về cho client."""
    return {
        "task_id": doc.get("task_id"),
        "status": doc.get("status"),
        "stage": doc.get("stage"),
        "progress": doc.get("progress", 0),
        "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at")
    }

async def event_stream(
    db,
    poll_seconds: float = 1.0,
    keepalive_seconds: float = 15.0,
    snapshot_limit: int = 100,
) -> AsyncGenerator[str, None]:
    """
    Async generator tạo SSE chunks theo dõi tiến trình tác vụ audio.
    Hoạt động tốt với nhiều worker processes nhờ đọc trực tiếp từ database (`updated_at`).
    """
    # 1. Lấy snapshot các tác vụ gần nhất khi client vừa kết nối
    snapshot = await AudioTaskStore.list_recent(db, snapshot_limit)
    snapshot_data = [task_view(t) for t in snapshot]
    yield format_sse("snapshot", {"tasks": snapshot_data})

    # Tạo chữ ký (signature) để theo dõi thay đổi
    def signature(doc):
        updated_at = doc.get("updated_at")
        ts = updated_at.timestamp() if isinstance(updated_at, datetime) else 0
        return f"{ts}|{doc.get('status')}|{doc.get('stage')}|{doc.get('progress')}"

    seen = {t["task_id"]: signature(t) for t in snapshot if t.get("updated_at")}
    
    timestamps = [t["updated_at"].timestamp() for t in snapshot if isinstance(t.get("updated_at"), datetime)]
    cursor = datetime.fromtimestamp(max(timestamps)) if timestamps else datetime.utcnow()
    
    last_sent = time.time()

    while True:
        await asyncio.sleep(poll_seconds)
        emitted = False

        updated_docs = await AudioTaskStore.list_updated_since(db, cursor)
        for doc in updated_docs:
            updated_at = doc.get("updated_at")
            if not updated_at or seen.get(doc.get("task_id")) == signature(doc):
                continue
            
            seen[doc.get("task_id")] = signature(doc)
            if updated_at > cursor:
                cursor = updated_at
            
            emitted = True
            yield format_sse("task", task_view(doc))

        current_time = time.time()
        if emitted:
            last_sent = current_time
        elif current_time - last_sent >= keepalive_seconds:
            last_sent = current_time
            yield format_sse("keepalive", "")