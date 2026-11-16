from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import AdminUser


def get_by_id(db: Session, admin_id: int):
    return db.query(AdminUser).filter(AdminUser.id == admin_id).first()


def get_by_username(db: Session, username: str):
    return db.query(AdminUser).filter(AdminUser.username == username).first()


def list_all(db: Session):
    return db.query(AdminUser).order_by(AdminUser.id).all()


def count_active_super_admins(db: Session) -> int:
    return (
        db.query(func.count(AdminUser.id))
        .filter(AdminUser.role == "super_admin", AdminUser.is_active.is_(True))
        .scalar()
    ) or 0


def create(db: Session, username: str, password_hash: str, role: str) -> AdminUser:
    admin = AdminUser(username=username, password_hash=password_hash, role=role)
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def update(db: Session, admin: AdminUser, changes: dict) -> AdminUser:
    for key, value in changes.items():
        setattr(admin, key, value)
    db.commit()
    db.refresh(admin)
    return admin


def delete(db: Session, admin: AdminUser) -> None:
    db.delete(admin)
    db.commit()
