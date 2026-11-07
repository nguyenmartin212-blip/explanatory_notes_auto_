"""Dữ liệu vào/ra của API điểm tham quan.
- POICreate / POIUpdate : admin gửi lên
- POIPublic             : trả cho du khách (đã chọn ngôn ngữ)
- POIAdmin              : trả cho admin (đầy đủ hơn)
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class POICreate(BaseModel):
    region_id: int
    category_id: Optional[int] = None
    name_vi: str = Field(min_length=2, max_length=200)
    description_vi: str = Field(min_length=20)
    latitude: float = Field(ge=8, le=24)        # nằm trong lãnh thổ Việt Nam
    longitude: float = Field(ge=102, le=110)
    trigger_radius: int = Field(default=50, ge=10, le=500)
    audio_priority: int = Field(default=0, ge=0, le=100)
    cover_image_url: Optional[str] = Field(default=None, max_length=500)


class POIUpdate(BaseModel):
    """Tất cả trường đều tùy chọn: gửi trường nào thì sửa trường đó."""
    region_id: Optional[int] = None
    category_id: Optional[int] = None
    name_vi: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description_vi: Optional[str] = Field(default=None, min_length=20)
    latitude: Optional[float] = Field(default=None, ge=8, le=24)
    longitude: Optional[float] = Field(default=None, ge=102, le=110)
    trigger_radius: Optional[int] = Field(default=None, ge=10, le=500)
    audio_priority: Optional[int] = Field(default=None, ge=0, le=100)
    cover_image_url: Optional[str] = Field(default=None, max_length=500)


class POIPublic(BaseModel):
    id: int
    region_id: int
    name: str
    description: str
    latitude: float
    longitude: float
    trigger_radius: int
    cover_image_url: Optional[str] = None
    audio_url: Optional[str] = None
    lang: str                      # ngôn ngữ thực sự của nội dung trả về
    is_fallback: bool              # True nếu phải dùng ngôn ngữ thay thế
    updated_at: Optional[datetime] = None   # để frontend biết nội dung có thay đổi không
    distance_m: Optional[float] = None      # chỉ có ở API /pois/nearby
    inside_trigger: Optional[bool] = None   # chỉ có ở API /pois/nearby


class POIAdmin(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    region_id: int
    category_id: Optional[int] = None
    name_vi: str
    description_vi: str
    latitude: float
    longitude: float
    trigger_radius: int
    audio_priority: int
    cover_image_url: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ActivationRequest(BaseModel):
    is_active: bool


class GenerateAudioRequest(BaseModel):
    # None = sinh cho tất cả ngôn ngữ đang bật
    langs: Optional[list[str]] = None
