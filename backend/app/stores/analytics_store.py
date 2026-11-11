from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import POI, QrCode, VisitEvent, VisitorDevice, VisitSession


# ---------- QR ----------
def get_qr_by_code(db: Session, code: str):
    return db.query(QrCode).filter(QrCode.code == code, QrCode.is_active.is_(True)).first()


def get_qr_by_code_any(db: Session, code: str):
    """Tìm theo mã, KỂ CẢ mã đã tắt (dùng để kiểm tra trùng khi tạo mới)."""
    return db.query(QrCode).filter(QrCode.code == code).first()


def update_qr(db: Session, qr: QrCode, changes: dict):
    for key, value in changes.items():
        setattr(qr, key, value)
    db.commit()
    db.refresh(qr)
    return qr


def get_qr_by_id(db: Session, qr_id: int):
    return db.query(QrCode).filter(QrCode.id == qr_id).first()


def list_qr(db: Session):
    return db.query(QrCode).order_by(QrCode.id).all()


def create_qr(db: Session, code: str, label: str, poi_id):
    qr = QrCode(code=code, label=label, poi_id=poi_id)
    db.add(qr)
    db.commit()
    db.refresh(qr)
    return qr


def delete_qr(db: Session, qr: QrCode) -> None:
    db.delete(qr)
    db.commit()


# ---------- Thiết bị / phiên / sự kiện ----------
def get_device(db: Session, device_id: str):
    return db.query(VisitorDevice).filter(VisitorDevice.id == device_id).first()


def create_device(db: Session, device_id: str, lang_code, device_type: str):
    device = VisitorDevice(id=device_id, preferred_lang=lang_code, device_type=device_type)
    db.add(device)
    db.commit()
    return device


def touch_device(db: Session, device: VisitorDevice, lang_code=None):
    device.last_seen_at = datetime.now()
    if lang_code:
        device.preferred_lang = lang_code
    db.commit()


def create_session(db: Session, device_id: str, qr_code_id, lang_code):
    session = VisitSession(device_id=device_id, qr_code_id=qr_code_id, lang_code=lang_code)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: int):
    return db.query(VisitSession).filter(VisitSession.id == session_id).first()


def touch_session(db: Session, session: VisitSession):
    session.last_seen_at = datetime.now()
    db.commit()


def add_event(db: Session, session_id: int, event_type: str, poi_id=None, lang_code=None):
    db.add(VisitEvent(session_id=session_id, event_type=event_type, poi_id=poi_id, lang_code=lang_code))
    db.commit()


# ---------- Thống kê ----------
def count_online(db: Session, window_seconds: int) -> int:
    """Đếm số THIẾT BỊ (không đếm số tab) có nhịp heartbeat trong N giây gần nhất."""
    since = datetime.now() - timedelta(seconds=window_seconds)
    return (
        db.query(func.count(func.distinct(VisitSession.device_id)))
        .filter(VisitSession.last_seen_at >= since)
        .scalar()
    ) or 0


def count_sessions(db: Session) -> int:
    return db.query(func.count(VisitSession.id)).scalar() or 0


def scans_by_day(db: Session, days: int = 7):
    since = datetime.now() - timedelta(days=days)
    day = func.date(VisitEvent.created_at)
    rows = (
        db.query(day, func.count(VisitEvent.id))
        .filter(VisitEvent.event_type == "qr_scan", VisitEvent.created_at >= since)
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [(str(d), c) for d, c in rows]


def count_unique_visitors(db: Session) -> int:
    """Số khách (thiết bị) khác nhau từ trước đến nay."""
    return db.query(func.count(func.distinct(VisitSession.device_id))).scalar() or 0


def count_qr_scans(db: Session) -> int:
    return db.query(func.count(VisitEvent.id)).filter(VisitEvent.event_type == "qr_scan").scalar() or 0


def visitors_by_day(db: Session, days: int = 7):
    """Mỗi ngày có bao nhiêu khách (thiết bị) khác nhau."""
    since = datetime.now() - timedelta(days=days)
    day = func.date(VisitSession.started_at)
    rows = (
        db.query(day, func.count(func.distinct(VisitSession.device_id)))
        .filter(VisitSession.started_at >= since)
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [(str(d), c) for d, c in rows]


def top_pois_by_event(db: Session, event_type: str, limit: int = 5):
    """Top điểm theo một loại sự kiện: 'view_poi' (lượt xem) hoặc 'play_audio' (lượt nghe)."""
    cnt = func.count(VisitEvent.id)
    return (
        db.query(POI.id, POI.name_vi, cnt)
        .join(VisitEvent, VisitEvent.poi_id == POI.id)
        .filter(VisitEvent.event_type == event_type)
        .group_by(POI.id, POI.name_vi)
        .order_by(cnt.desc())
        .limit(limit)
        .all()
    )


def sessions_by_language(db: Session):
    cnt = func.count(VisitSession.id)
    return (
        db.query(VisitSession.lang_code, cnt)
        .filter(VisitSession.lang_code.isnot(None))
        .group_by(VisitSession.lang_code)
        .order_by(cnt.desc())
        .all()
    )


def sessions_by_qr(db: Session):
    cnt = func.count(VisitSession.id)
    return (
        db.query(QrCode.label, cnt)
        .join(VisitSession, VisitSession.qr_code_id == QrCode.id)
        .group_by(QrCode.id, QrCode.label)
        .order_by(cnt.desc())
        .all()
    )
