"""Tính khoảng cách và tìm điểm gần."""

from math import asin, cos, radians, sin, sqrt


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Khoảng cách (mét) giữa 2 tọa độ trên mặt cầu (công thức Haversine)."""
    r = 6371000  # bán kính Trái Đất, mét
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    )
    return 2 * r * asin(sqrt(a))


def find_nearby(pois, lat: float, lng: float, radius_m: float):
    """Trả về danh sách (poi, khoảng_cách, đang_trong_vùng_kích_hoạt).

    Sắp xếp: điểm đang trong vùng kích hoạt lên trước (ưu tiên audio_priority cao,
    rồi gần hơn), sau đó đến các điểm còn lại theo khoảng cách."""
    result = []
    for poi in pois:
        dist = haversine_m(lat, lng, poi.latitude, poi.longitude)
        if dist <= radius_m:
            inside = dist <= poi.trigger_radius
            result.append((poi, dist, inside))

    def sort_key(item):
        poi, dist, inside = item
        if inside:
            return (0, -poi.audio_priority, dist)
        return (1, 0, dist)

    result.sort(key=sort_key)
    return result
