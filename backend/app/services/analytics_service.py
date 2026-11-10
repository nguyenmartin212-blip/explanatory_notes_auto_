"""Thống kê: đếm người online bằng heartbeat, ghi sự kiện, tổng hợp báo cáo."""
from sqlalchemy.orm import Session

from app.core.constants import ONLINE_WINDOW_SECONDS
from app.core.exceptions import AppError
from app.schemas.analytics import (DayCount, LangCount, PoiCount, QrCount, QrCreate, QrUpdate,
                                   SessionRequest, StatsSummary)
from app.stores import analytics_store, poi_store


# ------------------------------------------------------------ phía du khách
def start_session(db: Session, data: SessionRequest):
    """Gọi khi du khách quét QR / mở web. Trả về (session_id, qr hoặc None)."""
    device = analytics_store.get_device(db, data.device_id)
    if device is None:
        analytics_store.create_device(db, data.device_id, data.lang_code, data.device_type)
    else:
        analytics_store.touch_device(db, device, data.lang_code)

    qr = analytics_store.get_qr_by_code(db, data.qr_code) if data.qr_code else None
    session = analytics_store.create_session(db, data.device_id, qr.id if qr else None, data.lang_code)

    if qr is not None:
        analytics_store.add_event(db, session.id, "qr_scan", qr.poi_id, data.lang_code)
    return session.id, qr


def heartbeat(db: Session, session_id: int) -> None:
    """Nhịp 'tôi vẫn còn đây' (frontend gửi mỗi ~30 giây)."""
    session = analytics_store.get_session(db, session_id)
    if session is None:
        raise AppError(404, "Phiên không tồn tại, hãy tạo phiên mới")
    analytics_store.touch_session(db, session)
    device = analytics_store.get_device(db, session.device_id)
    if device is not None:
        analytics_store.touch_device(db, device)


def add_event(db: Session, session_id: int, event_type: str, poi_id, lang_code) -> None:
    if analytics_store.get_session(db, session_id) is None:
        raise AppError(404, "Phiên không tồn tại, hãy tạo phiên mới")
    analytics_store.add_event(db, session_id, event_type, poi_id, lang_code)


# ---------------------------------------------------------------- phía admin
def online_now(db: Session) -> int:
    return analytics_store.count_online(db, ONLINE_WINDOW_SECONDS)


def _poi_counts(rows):
    return [PoiCount(poi_id=i, name=n, count=c) for i, n, c in rows]


def summary(db: Session) -> StatsSummary:
    return StatsSummary(
        online_now=online_now(db),
        total_sessions=analytics_store.count_sessions(db),
        unique_visitors=analytics_store.count_unique_visitors(db),
        total_qr_scans=analytics_store.count_qr_scans(db),
        scans_last_7_days=[DayCount(date=d, count=c) for d, c in analytics_store.scans_by_day(db, 7)],
        visitors_last_7_days=[DayCount(date=d, count=c) for d, c in analytics_store.visitors_by_day(db, 7)],
        top_pois_by_views=_poi_counts(analytics_store.top_pois_by_event(db, "view_poi")),
        top_pois_by_plays=_poi_counts(analytics_store.top_pois_by_event(db, "play_audio")),
        languages=[LangCount(lang_code=l, count=c) for l, c in analytics_store.sessions_by_language(db)],
        qr_ranking=[QrCount(label=l, count=c) for l, c in analytics_store.sessions_by_qr(db)],
    )


# ----------------------------------------------------------------- mã QR
def create_qr(db: Session, data: QrCreate):
    if analytics_store.get_qr_by_code_any(db, data.code) is not None:
        raise AppError(400, "Mã QR này đã tồn tại")
    if data.poi_id is not None and poi_store.get(db, data.poi_id) is None:
        raise AppError(400, "Điểm tham quan không tồn tại")
    return analytics_store.create_qr(db, data.code, data.label, data.poi_id)


def update_qr(db: Session, qr_id: int, data: QrUpdate):
    """Đổi nhãn, gán lại điểm, hoặc bật/tắt mã QR."""
    qr = analytics_store.get_qr_by_id(db, qr_id)
    if qr is None:
        raise AppError(404, "Không tìm thấy mã QR")

    # poi_id được phép là None (bỏ liên kết); label và is_active thì không
    changes = {
        k: v for k, v in data.model_dump(exclude_unset=True).items()
        if v is not None or k == "poi_id"
    }
    if changes.get("poi_id") is not None and poi_store.get(db, changes["poi_id"]) is None:
        raise AppError(400, "Điểm tham quan không tồn tại")
    return analytics_store.update_qr(db, qr, changes)


def delete_qr(db: Session, qr_id: int) -> None:
    qr = analytics_store.get_qr_by_id(db, qr_id)
    if qr is None:
        raise AppError(404, "Không tìm thấy mã QR")
    analytics_store.delete_qr(db, qr)
