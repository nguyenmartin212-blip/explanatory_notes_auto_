from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Language, PoiLocalization


# ---------- Ngôn ngữ ----------
def list_active_languages(db: Session):
    return db.query(Language).filter(Language.is_active.is_(True)).order_by(Language.code).all()


def get_language(db: Session, code: str):
    return db.query(Language).filter(Language.code == code).first()


# ---------- Bản dịch ----------
def get(db: Session, poi_id: int, lang_code: str):
    return (
        db.query(PoiLocalization)
        .filter(PoiLocalization.poi_id == poi_id, PoiLocalization.lang_code == lang_code)
        .first()
    )


def list_by_poi(db: Session, poi_id: int):
    return (
        db.query(PoiLocalization)
        .filter(PoiLocalization.poi_id == poi_id)
        .order_by(PoiLocalization.lang_code)
        .all()
    )


def get_map(db: Session, poi_ids, lang_codes):
    """Lấy nhiều bản dịch trong 1 câu truy vấn.
    Trả về dict: {(poi_id, lang_code): bản dịch}"""
    if not poi_ids:
        return {}
    rows = (
        db.query(PoiLocalization)
        .filter(PoiLocalization.poi_id.in_(list(poi_ids)),
                PoiLocalization.lang_code.in_(list(lang_codes)))
        .all()
    )
    return {(r.poi_id, r.lang_code): r for r in rows}


def upsert(db: Session, poi_id: int, lang_code: str, name: str, description: str,
           is_machine_translated: bool, audio_status: str = "none"):
    """Có rồi thì cập nhật, chưa có thì thêm mới."""
    loc = get(db, poi_id, lang_code)
    if loc is None:
        loc = PoiLocalization(poi_id=poi_id, lang_code=lang_code)
        db.add(loc)
    loc.name = name
    loc.description = description
    loc.is_machine_translated = is_machine_translated
    loc.audio_status = audio_status
    loc.updated_at = datetime.now()
    db.commit()
    db.refresh(loc)
    return loc


def set_audio(db: Session, loc: PoiLocalization, audio_url, status: str, content_hash=None):
    loc.audio_url = audio_url
    loc.audio_status = status
    loc.content_hash = content_hash
    loc.updated_at = datetime.now()
    db.commit()
    db.refresh(loc)
    return loc


def mark_stale(db: Session, poi_id: int):
    """Nội dung gốc đã đổi: vô hiệu audio cũ. Trả về danh sách audio_url cũ để xóa file."""
    old_urls = []
    for loc in list_by_poi(db, poi_id):
        if loc.audio_url:
            old_urls.append(loc.audio_url)
        loc.audio_url = None
        loc.content_hash = None
        loc.audio_status = "processing"
    db.commit()
    return old_urls
