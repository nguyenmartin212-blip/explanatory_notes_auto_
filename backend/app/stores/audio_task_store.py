"""Store for the SQL-backed audio queue used by the Extra SSE and recovery services."""
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.database import SessionLocal
from app.models.web import AudioTask


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def enqueue(db, poi_id, langs=None, translate=True, *, commit=True):
    task = AudioTask(poi_id=poi_id, langs=langs, translate=translate, status="queued", updated_at=utc_now())
    db.add(task)
    db.flush()
    task_id = task.id
    if commit:
        db.commit()
    return task_id


def claim():
    with SessionLocal.begin() as db:
        task = db.scalar(select(AudioTask).where(AudioTask.status == "queued").order_by(AudioTask.id).limit(1)
                         .with_for_update(skip_locked=True))
        if task is None:
            return None
        task.status = "running"
        task.stage = "translation"
        task.updated_at = utc_now()
        return task.id, task.poi_id, task.langs, task.translate


def mark(task_id, *, status=None, stage, progress, error=None):
    with SessionLocal.begin() as db:
        task = db.get(AudioTask, task_id)
        if task is not None:
            if status:
                task.status = status
            task.stage = stage
            task.progress = progress
            task.error = error
            task.updated_at = utc_now()


def _document(task):
    return {
        "task_id": str(task.id), "poi_id": task.poi_id, "status": task.status,
        "stage": task.stage, "progress": task.progress, "updated_at": task.updated_at,
        "error": task.error,
    }


class AudioTaskStore:
    @staticmethod
    def requeue_all_running():
        with SessionLocal.begin() as db:
            result = db.execute(update(AudioTask).where(AudioTask.status == "running").values(
                status="queued", stage=None, progress=0, error=None, updated_at=utc_now()
            ))
            return result.rowcount

    @staticmethod
    def list_recent(limit):
        with SessionLocal() as db:
            tasks = db.scalars(select(AudioTask).order_by(AudioTask.updated_at.desc(), AudioTask.id.desc()).limit(limit))
            return [_document(task) for task in tasks]

    @staticmethod
    def list_updated_since(cursor):
        with SessionLocal() as db:
            tasks = db.scalars(select(AudioTask).where(AudioTask.updated_at >= cursor)
                               .order_by(AudioTask.updated_at, AudioTask.id))
            return [_document(task) for task in tasks]
