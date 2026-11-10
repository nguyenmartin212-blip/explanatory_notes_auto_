"""UC-07: Tải và sử dụng offline.

Backend KHÔNG lưu gì trên máy du khách. Nó chỉ cung cấp một 'manifest' gồm toàn bộ điểm
(đã chọn sẵn ngôn ngữ, có fallback) kèm đường dẫn audio và mã phiên bản.
Frontend (Service Worker + IndexedDB) tải các file về và lưu lại; lần sau chỉ cần gọi
/offline/version, thấy phiên bản đổi mới tải lại.
"""
import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.schemas.offline import OfflineManifest, OfflinePoi, OfflineVersion
from app.services import localization_service, tts_service
from app.stores import localization_store, poi_store, region_store

MAX_POIS = 1000


def build_manifest(db: Session, lang: str, region_code: Optional[str]) -> OfflineManifest:
    region_id = None
    if region_code:
        region = region_store.get_by_code(db, region_code)
        if region is None:
            raise AppError(404, "Không tìm thấy miền")
        region_id = region.id

    pois = poi_store.list_active(db, region_id, 0, MAX_POIS)
    loc_map = localization_store.get_map(
        db, [p.id for p in pois], localization_service.lang_codes_needed(lang)
    )

    items = []
    total_bytes = 0
    hasher = hashlib.md5()
    for poi in pois:
        content = localization_service.pick_content(poi, loc_map, lang)

        times = [t for t in (poi.updated_at, content.get("updated_at")) if t is not None]
        version = max(times).isoformat() if times else "0"

        size = tts_service.audio_size(content["audio_url"])
        total_bytes += size or 0
        hasher.update(f"{poi.id}|{content['audio_url']}|{content['lang']}|{version};".encode("utf-8"))

        items.append(OfflinePoi(
            id=poi.id,
            region_id=poi.region_id,
            name=content["name"],
            description=content["description"],
            latitude=poi.latitude,
            longitude=poi.longitude,
            trigger_radius=poi.trigger_radius,
            audio_priority=poi.audio_priority,
            cover_image_url=poi.cover_image_url,
            audio_url=content["audio_url"],
            audio_bytes=size,
            lang=content["lang"],
            is_fallback=content["is_fallback"],
            version=version,
        ))

    return OfflineManifest(
        lang=lang,
        region=region_code,
        version=hasher.hexdigest()[:12],
        generated_at=datetime.now(),
        poi_count=len(items),
        total_audio_bytes=total_bytes,
        items=items,
    )


def get_version(db: Session, lang: str, region_code: Optional[str]) -> OfflineVersion:
    m = build_manifest(db, lang, region_code)
    return OfflineVersion(lang=m.lang, region=m.region, version=m.version, poi_count=m.poi_count)
