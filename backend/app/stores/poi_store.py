from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Category, POI, PoiImage


def list_categories(db: Session):
    return db.query(Category).order_by(Category.name_vi, Category.id).all()


def category_exists(db: Session, category_id: int) -> bool:
    return db.get(Category, category_id) is not None


def list_active(db: Session, region_id=None, skip=0, limit=20):
    """Điểm đang hiển thị cho du khách."""
    q = db.query(POI).options(joinedload(POI.region), selectinload(POI.images)).filter(POI.is_active.is_(True))
    if region_id:
        q = q.filter(POI.region_id == region_id)
    return q.order_by(POI.id).offset(skip).limit(limit).all()


def list_all_active(db: Session, region_id=None, *, images=False):
    """Toàn bộ điểm đang hiển thị."""
    q = db.query(POI).options(joinedload(POI.region)).filter(POI.is_active.is_(True))
    if region_id is not None:
        q = q.filter(POI.region_id == region_id)
    if images:
        q = q.options(selectinload(POI.images))
    return q.order_by(POI.id).all()


def list_all(db: Session, region_id=None, skip=0, limit=50):
    """Tất cả điểm kể cả chưa kích hoạt (dành cho admin)."""
    q = db.query(POI).options(selectinload(POI.images))
    if region_id:
        q = q.filter(POI.region_id == region_id)
    return q.order_by(POI.id).offset(skip).limit(limit).all()


def get(db: Session, poi_id: int, *, lock: bool = False):
    query = db.query(POI).filter(POI.id == poi_id)
    if lock:
        query = query.populate_existing().with_for_update()
    return query.first()


def create(db: Session, data: dict) -> POI:
    poi = POI()
    db.add(poi)
    return update(db, poi, data)


def update(db: Session, poi: POI, changes: dict) -> POI:
    for key, value in changes.items():
        if key == "image_urls":
            if value != poi.image_urls:
                previous = {image.image_url: image for image in poi.images}
                images = []
                for index, url in enumerate(dict.fromkeys(value)):
                    image = previous.get(url) or PoiImage(image_url=url)
                    image.sort_order = index
                    images.append(image)
                poi.images = images
            continue
        setattr(poi, key, value)
    db.flush()
    return poi


def set_active(db: Session, poi: POI, is_active: bool) -> POI:
    poi.is_active = is_active
    db.flush()
    return poi


def delete(db: Session, poi: POI) -> None:
    db.delete(poi)  # bản dịch và ảnh xóa theo (cascade)
    db.flush()
