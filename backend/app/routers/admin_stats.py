"""API admin: thống kê và quản lý mã QR."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.schemas.analytics import OnlineResponse, QrCreate, QrOut, QrUpdate, StatsSummary
from app.services import analytics_service
from app.stores import analytics_store

router = APIRouter(
    prefix="/api/v1/admin",
    tags=["Admin - Thống kê & QR"],
    dependencies=[Depends(get_current_admin)],
)


@router.get("/stats/online", response_model=OnlineResponse)
def online_now(db: Session = Depends(get_db)):
    """Số người đang online (thiết bị có heartbeat trong 90 giây gần nhất)."""
    return OnlineResponse(online_now=analytics_service.online_now(db))


@router.get("/stats/summary", response_model=StatsSummary)
def stats_summary(db: Session = Depends(get_db)):
    """Tổng hợp: số người online, lượt khách, lượt quét QR, top điểm (xem / nghe), ngôn ngữ, QR hiệu quả."""
    return analytics_service.summary(db)


@router.get("/qr", response_model=list[QrOut])
def list_qr(db: Session = Depends(get_db)):
    return analytics_store.list_qr(db)


@router.post("/qr", response_model=QrOut, status_code=201)
def create_qr(data: QrCreate, db: Session = Depends(get_db)):
    """Tạo mã QR. Đường dẫn cần in vào mã QR: https://<trang-web>/?qr=<code>"""
    return analytics_service.create_qr(db, data)


@router.patch("/qr/{qr_id}", response_model=QrOut)
def update_qr(qr_id: int, data: QrUpdate, db: Session = Depends(get_db)):
    """Sửa mã QR: đổi nhãn, gán lại điểm (hoặc gửi poi_id = null để bỏ), bật/tắt."""
    return analytics_service.update_qr(db, qr_id, data)


@router.delete("/qr/{qr_id}", status_code=204)
def delete_qr(qr_id: int, db: Session = Depends(get_db)):
    analytics_service.delete_qr(db, qr_id)
