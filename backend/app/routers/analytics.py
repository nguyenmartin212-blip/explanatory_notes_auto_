"""API thống kê phía du khách: tạo phiên, heartbeat, ghi sự kiện."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.analytics import EventRequest, HeartbeatRequest, SessionRequest, SessionResponse
from app.schemas.common import MessageResponse
from app.services import analytics_service

router = APIRouter(prefix="/api/v1/analytics", tags=["Thống kê (du khách)"])


@router.post("/session", response_model=SessionResponse, status_code=201)
def start_session(data: SessionRequest, db: Session = Depends(get_db)):
    """Gọi khi du khách quét QR / mở web. Trả về session_id để dùng cho heartbeat và event.
    Nếu vào bằng mã QR thì trả thêm poi_id của điểm gắn với mã đó."""
    session_id, qr = analytics_service.start_session(db, data)
    return SessionResponse(
        session_id=session_id,
        qr_valid=(qr is not None) if data.qr_code else None,
        qr_label=qr.label if qr else None,
        poi_id=qr.poi_id if qr else None,
    )


@router.post("/heartbeat", response_model=MessageResponse)
def heartbeat(data: HeartbeatRequest, db: Session = Depends(get_db)):
    """Frontend gọi mỗi ~30 giây để báo 'tôi vẫn đang dùng'."""
    analytics_service.heartbeat(db, data.session_id)
    return MessageResponse(detail="ok")


@router.post("/event", response_model=MessageResponse, status_code=201)
def add_event(data: EventRequest, db: Session = Depends(get_db)):
    """Ghi 1 hành động: view_poi, play_audio, finish_audio, change_lang..."""
    analytics_service.add_event(db, data.session_id, data.event_type, data.poi_id, data.lang_code)
    return MessageResponse(detail="ok")
