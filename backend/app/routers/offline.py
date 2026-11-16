"""UC-07: API phục vụ chế độ offline (công khai, không cần đăng nhập)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.offline import OfflineManifest, OfflineVersion
from app.services import offline_service

router = APIRouter(prefix="/api/v1/offline", tags=["Du khách - Offline"])


@router.get("/manifest", response_model=OfflineManifest)
def manifest(
    lang: str = Query("vi", description="Ngôn ngữ muốn tải về"),
    region: Optional[str] = Query(None, description="Chỉ tải 1 miền: north, central, south"),
    db: Session = Depends(get_db),
):
    """Gói dữ liệu để dùng offline: danh sách điểm + đường dẫn audio + dung lượng + phiên bản."""
    return offline_service.build_manifest(db, lang, region)


@router.get("/version", response_model=OfflineVersion)
def version(
    lang: str = Query("vi"),
    region: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Kiểm tra nhanh phiên bản hiện tại. Khác với phiên bản đã lưu trên máy -> cần tải lại."""
    return offline_service.get_version(db, lang, region)
