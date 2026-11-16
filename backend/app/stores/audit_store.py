from sqlalchemy.orm import Session

from app.models import AuditLog


def add(db: Session, user_id, action: str, resource: str, resource_id=None) -> None:
    db.add(AuditLog(user_id=user_id, action=action, resource=resource, resource_id=resource_id))
    db.commit()


def list_recent(db: Session, limit: int = 50):
    return db.query(AuditLog).order_by(AuditLog.id.desc()).limit(limit).all()
