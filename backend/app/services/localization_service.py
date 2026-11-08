"""Lấy nội dung theo ngôn ngữ, có FALLBACK 3 tầng, và lưu bản dịch sửa tay."""
from sqlalchemy.orm import Session

from app.core.constants import FALLBACK_LANG, SOURCE_LANG
from app.core.exceptions import AppError
from app.services import audit_service
from app.stores import localization_store, poi_store


def pick_content(poi, loc_map: dict, lang: str) -> dict:
    """Chọn nội dung hiển thị cho 1 điểm.

    Tầng 1: đúng ngôn ngữ yêu cầu
    Tầng 2: tiếng Anh
    Tầng 3: tiếng Việt gốc (luôn có, nên du khách không bao giờ gặp màn hình trống)
    """
    for code in (lang, FALLBACK_LANG):
        loc = loc_map.get((poi.id, code))
        if loc is not None and loc.description:
            return {
                "name": loc.name,
                "description": loc.description,
                "audio_url": loc.audio_url if loc.audio_status == "ready" else None,
                "lang": code,
                "is_fallback": code != lang,
                "updated_at": getattr(loc, "updated_at", None),
            }

    vi = loc_map.get((poi.id, SOURCE_LANG))
    return {
        "name": poi.name_vi,
        "description": poi.description_vi,
        "audio_url": vi.audio_url if vi is not None and vi.audio_status == "ready" else None,
        "lang": SOURCE_LANG,
        "is_fallback": lang != SOURCE_LANG,
        "updated_at": getattr(vi, "updated_at", None) if vi is not None else getattr(poi, "updated_at", None),
    }


def lang_codes_needed(lang: str) -> set:
    """Các ngôn ngữ cần tải để làm fallback."""
    return {lang, FALLBACK_LANG, SOURCE_LANG}


def list_for_poi(db: Session, poi_id: int):
    if poi_store.get(db, poi_id) is None:
        raise AppError(404, "Không tìm thấy điểm tham quan")
    return localization_store.list_by_poi(db, poi_id)


def save_manual(db: Session, poi_id: int, lang: str, name: str, description: str, admin):
    """Admin sửa tay bản dịch. Audio sẽ được sinh lại (router gọi pipeline chạy nền)."""
    if lang == SOURCE_LANG:
        raise AppError(400, "Tiếng Việt là nội dung gốc, hãy sửa trực tiếp ở điểm tham quan")
    if poi_store.get(db, poi_id) is None:
        raise AppError(404, "Không tìm thấy điểm tham quan")
    language = localization_store.get_language(db, lang)
    if language is None:
        raise AppError(400, f"Ngôn ngữ '{lang}' chưa được hỗ trợ")

    loc = localization_store.upsert(
        db, poi_id, lang, name, description,
        is_machine_translated=False, audio_status="processing",
    )
    audit_service.log(db, admin, "update_localization", "poi_localizations", loc.id)
    return loc
