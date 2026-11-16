from sqlalchemy.orm import Session

from app.stores import audit_store


def log(db: Session, admin, action: str, resource: str, resource_id=None) -> None:
    """Ghi nhật ký thao tác của admin."""
    audit_store.add(db, admin.id if admin else None, action, resource, resource_id)
