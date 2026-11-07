from typing import Literal, Optional

from pydantic import BaseModel, Field


class SessionRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=36)  # UUID do frontend tạo
    qr_code: Optional[str] = Field(default=None, max_length=40)
    lang_code: Optional[str] = Field(default=None, max_length=10)
    device_type: Literal["mobile", "tablet", "desktop", "unknown"] = "unknown"


class SessionResponse(BaseModel):
    session_id: int
    # Chỉ có khi du khách vào bằng mã QR (UC-01):
    qr_valid: Optional[bool] = None    # True = mã QR hợp lệ, False = mã sai/đã tắt, None = không quét QR
    qr_label: Optional[str] = None     # nơi đặt mã QR, ví dụ "QR cổng chính Phố cổ Hội An"
    poi_id: Optional[int] = None       # điểm gắn với mã QR -> frontend mở thẳng trang điểm đó


class HeartbeatRequest(BaseModel):
    session_id: int


class EventRequest(BaseModel):
    session_id: int
    event_type: Literal["qr_scan", "view_poi", "play_audio", "finish_audio", "change_lang"]
    poi_id: Optional[int] = None
    lang_code: Optional[str] = Field(default=None, max_length=10)


class OnlineResponse(BaseModel):
    online_now: int


class DayCount(BaseModel):
    date: str
    count: int


class PoiCount(BaseModel):
    poi_id: int
    name: str
    count: int


class LangCount(BaseModel):
    lang_code: str
    count: int


class QrCount(BaseModel):
    label: str
    count: int


class StatsSummary(BaseModel):
    online_now: int                       # số người đang online
    total_sessions: int                   # tổng số lượt vào (mỗi lần mở web/quét QR là 1 phiên)
    unique_visitors: int                  # số khách khác nhau (đếm theo thiết bị)
    total_qr_scans: int                   # tổng lượt quét QR
    scans_last_7_days: list[DayCount]     # lượt quét QR mỗi ngày
    visitors_last_7_days: list[DayCount]  # lượt khách (thiết bị khác nhau) mỗi ngày
    top_pois_by_views: list[PoiCount]     # top điểm được XEM nhiều nhất
    top_pois_by_plays: list[PoiCount]     # top điểm được NGHE audio nhiều nhất
    languages: list[LangCount]
    qr_ranking: list[QrCount]


class QrCreate(BaseModel):
    code: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=2, max_length=150)
    poi_id: Optional[int] = None


class QrUpdate(BaseModel):
    """Sửa mã QR. Không cho đổi 'code' vì mã đã in ra giấy. Gửi trường nào sửa trường đó."""
    label: Optional[str] = Field(default=None, min_length=2, max_length=150)
    poi_id: Optional[int] = None     # gửi null để bỏ liên kết với điểm
    is_active: Optional[bool] = None


class QrOut(BaseModel):
    id: int
    code: str
    label: str
    poi_id: Optional[int] = None
    is_active: bool

    model_config = {"from_attributes": True}
