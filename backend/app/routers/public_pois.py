"""API công khai cho du khách (không cần đăng nhập)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.language import LanguageOut
from app.schemas.poi import POIPublic
from app.schemas.region import RegionOut
from app.services import poi_service
from app.stores import localization_store, region_store

router = APIRouter(prefix="/api/v1", tags=["Du khách"])


@router.get("/regions", response_model=list[RegionOut])
def list_regions(db: Session = Depends(get_db)):
    """Danh sách miền (Bắc / Trung / Nam)."""
    return region_store.list_all(db)


@router.get("/languages", response_model=list[LanguageOut])
def list_languages(db: Session = Depends(get_db)):
    """Các ngôn ngữ hỗ trợ."""
    return localization_store.list_active_languages(db)


@router.get("/pois", response_model=list[POIPublic])
def list_pois(
    region: Optional[str] = Query(None, description="Mã miền: north, central, south"),
    lang: str = Query("vi", description="Mã ngôn ngữ: vi, en, zh, ja, ko"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Danh sách điểm tham quan đang hiển thị, có fallback ngôn ngữ."""
    return poi_service.list_public(db, region, lang, skip, limit)


# LƯU Ý: /pois/nearby phải khai báo TRƯỚC /pois/{poi_id}, nếu không "nearby" bị hiểu là một id
@router.get("/pois/nearby", response_model=list[POIPublic])
def nearby_pois(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius: float = Query(500, gt=0, le=50000, description="Bán kính tìm kiếm (mét)"),
    lang: str = Query("vi"),
    db: Session = Depends(get_db),
):
    """Các điểm quanh vị trí hiện tại, kèm khoảng cách và cờ 'đang trong vùng kích hoạt'."""
    return poi_service.nearby_public(db, lat, lng, radius, lang)


@router.get("/pois/{poi_id}", response_model=POIPublic)
def get_poi(poi_id: int, lang: str = Query("vi"), db: Session = Depends(get_db)):
    """Chi tiết một điểm."""
    return poi_service.get_public(db, poi_id, lang)
