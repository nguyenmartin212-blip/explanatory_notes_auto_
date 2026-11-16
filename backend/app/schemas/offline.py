"""Dữ liệu 'gói offline' cho UC-07."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class OfflinePoi(BaseModel):
    id: int
    region_id: int
    name: str
    description: str
    region_code: str
    latitude: float
    longitude: float
    trigger_radius: int
    audio_priority: int
    cover_image_url: Optional[str] = None
    image_urls: list[str] = Field(default_factory=list)
    audio_url: Optional[str] = None
    audio_bytes: Optional[int] = None   # dung lượng file audio, để hiện "Tải về 12 MB"
    lang: str
    is_fallback: bool
    version: str                        # đổi khi nội dung đổi -> frontend biết cần tải lại


class OfflineManifest(BaseModel):
    lang: str
    region: Optional[str] = None
    version: str                        # phiên bản của CẢ gói
    generated_at: datetime
    poi_count: int
    total_audio_bytes: int
    items: list[OfflinePoi]


class OfflineVersion(BaseModel):
    """Bản nhẹ: chỉ để kiểm tra 'gói offline đã cũ chưa' mà không tải cả gói."""
    lang: str
    region: Optional[str] = None
    version: str
    poi_count: int
