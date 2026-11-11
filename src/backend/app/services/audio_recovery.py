import logging
from app.stores.audio_task_store import AudioTaskStore

logger = logging.getLogger(__name__)

async def recover_audio_tasks(db) -> int:
    """
    Bước 4a — Khôi phục các tác vụ audio bị gián đoạn do khởi động lại server.
    """
    count = await AudioTaskStore.requeue_all_running(db)
    if count:
        logger.warning(f"Đã khôi phục {count} tác vụ audio bị gián đoạn sau khi khởi động lại.")
    return count