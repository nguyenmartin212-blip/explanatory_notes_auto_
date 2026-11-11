"""Store = nơi DUY NHẤT viết câu truy vấn database."""
from sqlalchemy.orm import Session

from app.models import Region


def list_all(db: Session):
    return db.query(Region).order_by(Region.id).all()


def get_by_id(db: Session, region_id: int):
    return db.query(Region).filter(Region.id == region_id).first()


def get_by_code(db: Session, code: str):
    return db.query(Region).filter(Region.code == code).first()
