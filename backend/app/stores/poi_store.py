from sqlalchemy.orm import Session

from app.models import POI


def list_active(db: Session, region_id=None, skip=0, limit=20):
    """Điểm đang hiển thị cho du khách."""
    q = db.query(POI).filter(POI.is_active.is_(True))
    if region_id:
        q = q.filter(POI.region_id == region_id)
    return q.order_by(POI.id).offset(skip).limit(limit).all()


def list_all_active(db: Session):
    """Toàn bộ điểm đang hiển thị (dùng để tìm điểm gần)."""
    return db.query(POI).filter(POI.is_active.is_(True)).all()


def list_all(db: Session, region_id=None, skip=0, limit=50):
    """Tất cả điểm kể cả chưa kích hoạt (dành cho admin)."""
    q = db.query(POI)
    if region_id:
        q = q.filter(POI.region_id == region_id)
    return q.order_by(POI.id).offset(skip).limit(limit).all()


def get(db: Session, poi_id: int):
    return db.query(POI).filter(POI.id == poi_id).first()


def create(db: Session, data: dict) -> POI:
    poi = POI(**data)
    db.add(poi)
    db.commit()
    db.refresh(poi)
    return poi


def update(db: Session, poi: POI, changes: dict) -> POI:
    for key, value in changes.items():
        setattr(poi, key, value)
    db.commit()
    db.refresh(poi)
    return poi


def set_active(db: Session, poi: POI, is_active: bool) -> POI:
    poi.is_active = is_active
    db.commit()
    db.refresh(poi)
    return poi


def delete(db: Session, poi: POI) -> None:
    db.delete(poi)  # bản dịch và ảnh xóa theo (cascade)
    db.commit()
