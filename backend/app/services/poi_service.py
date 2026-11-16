"""Nghiệp vụ điểm tham quan."""
from typing import Optional

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.database import has_tables
from app.schemas.poi import POICreate, POIPublic, POIUpdate
from app.services import audit_service, geo_service, localization_service
from app.stores import audio_task_store, localization_store, poi_store, region_store


# ---------------------------------------------------------------- du khách
def _to_public(poi, loc_map: dict, lang: str, distance=None, inside=None) -> POIPublic:
    content = localization_service.pick_content(poi, loc_map, lang)
    return POIPublic(
        id=poi.id,
        region_id=poi.region_id,
        name=content["name"],
        description=content["description"],
        region_code=poi.region.code,
        latitude=poi.latitude,
        longitude=poi.longitude,
        trigger_radius=poi.trigger_radius,
        audio_priority=poi.audio_priority,
        cover_image_url=poi.cover_image_url,
        image_urls=poi.image_urls,
        audio_url=content["audio_url"],
        lang=content["lang"],
        is_fallback=content["is_fallback"],
        updated_at=content.get("updated_at"),
        distance_m=round(distance, 1) if distance is not None else None,
        inside_trigger=inside,
    )


def list_public(db: Session, region_code: Optional[str], lang: str, skip: int, limit: int):
    region_id = None
    if region_code:
        region = region_store.get_by_code(db, region_code)
        if region is None:
            raise AppError(404, "Không tìm thấy miền")
        region_id = region.id

    pois = poi_store.list_active(db, region_id, skip, limit)
    loc_map = localization_store.get_map(
        db, [p.id for p in pois], localization_service.lang_codes_needed(lang)
    )
    return [_to_public(p, loc_map, lang) for p in pois]


def get_public(db: Session, poi_id: int, lang: str) -> POIPublic:
    poi = poi_store.get(db, poi_id)
    if poi is None or not poi.is_active:  # điểm chưa kích hoạt thì du khách không thấy
        raise AppError(404, "Không tìm thấy điểm tham quan")
    loc_map = localization_store.get_map(db, [poi.id], localization_service.lang_codes_needed(lang))
    return _to_public(poi, loc_map, lang)


def nearby_public(db: Session, lat: float, lng: float, radius: float, lang: str):
    pois = poi_store.list_all_active(db, images=True)
    found = geo_service.find_nearby(pois, lat, lng, radius)
    loc_map = localization_store.get_map(
        db, [p.id for p, _, _ in found], localization_service.lang_codes_needed(lang)
    )
    return [_to_public(p, loc_map, lang, dist, inside) for p, dist, inside in found]


# ------------------------------------------------------------------- admin
def get_or_404(db: Session, poi_id: int, *, lock=False):
    poi = poi_store.get(db, poi_id, lock=lock)
    if poi is None:
        raise AppError(404, "Không tìm thấy điểm tham quan")
    return poi


def _check_region(db: Session, region_id: int) -> None:
    if region_store.get_by_id(db, region_id) is None:
        raise AppError(400, "Miền không tồn tại")


def _check_category(db: Session, category_id: Optional[int]) -> None:
    if category_id is not None and not poi_store.category_exists(db, category_id):
        raise AppError(400, "Danh mục không tồn tại")


def create_poi(db: Session, data: POICreate, admin):
    _check_region(db, data.region_id)
    _check_category(db, data.category_id)
    poi = poi_store.create(db, data.model_dump())  # mặc định is_active = False
    if has_tables(db, "audio_tasks"):
        audio_task_store.enqueue(db, poi.id, commit=False)
    audit_service.log(db, admin, "create_poi", "pois", poi.id)
    return poi


def update_poi(db: Session, poi_id: int, data: POIUpdate, admin):
    """Cập nhật POI và xếp hàng tạo lại audio khi nội dung tiếng Việt thay đổi."""
    poi = get_or_404(db, poi_id, lock=True)

    # Chỉ lấy những trường admin thật sự gửi lên (bỏ None ở các trường bắt buộc)
    nullable_fields = {"category_id", "cover_image_url"}
    changes = {
        k: v for k, v in data.model_dump(exclude_unset=True).items()
        if v is not None or k in nullable_fields
    }
    if "region_id" in changes:
        _check_region(db, changes["region_id"])
    if "category_id" in changes:
        _check_category(db, changes["category_id"])

    text_changed = any(
        k in changes and changes[k] != getattr(poi, k) for k in ("name_vi", "description_vi")
    )

    poi_store.update(db, poi, changes)

    if text_changed:
        localization_store.mark_stale(db, poi.id)
        if has_tables(db, "audio_tasks"):
            audio_task_store.enqueue(db, poi.id, commit=False)

    audit_service.log(db, admin, "update_poi", "pois", poi.id)
    return poi


def delete_poi(db: Session, poi_id: int, admin) -> None:
    poi = get_or_404(db, poi_id, lock=True)
    poi_store.delete(db, poi)
    audit_service.log(db, admin, "delete_poi", "pois", poi_id)


def set_activation(db: Session, poi_id: int, is_active: bool, admin):
    """Cổng kích hoạt: chỉ cho hiển thị khi đã có bản tiếng Anh kèm audio sẵn sàng."""
    poi = get_or_404(db, poi_id, lock=True)
    if is_active:
        en = localization_store.get(db, poi.id, "en", lock=True)
        if not localization_service.ready_audio(en):
            raise AppError(
                400,
                "Chưa thể bật hiển thị: điểm cần có bản tiếng Anh với audio sẵn sàng. "
                "Hãy chạy 'generate-audio' rồi kiểm tra trạng thái bản dịch.",
            )
    poi_store.set_active(db, poi, is_active)
    audit_service.log(db, admin, "activate_poi" if is_active else "deactivate_poi", "pois", poi.id)
    return poi
