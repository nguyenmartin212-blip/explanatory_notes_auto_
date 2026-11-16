"""Lấy nội dung theo ngôn ngữ, có FALLBACK 3 tầng, và lưu bản dịch sửa tay."""
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.core.constants import FALLBACK_LANG, SOURCE_LANG
from app.core.exceptions import AppError
from app.services import audit_service, tts_service
from app.stores import audio_task_store, localization_store, poi_store


def ready_audio(loc):
    if loc is None or loc.audio_status != "ready" or not loc.audio_url:
        return None
    value = loc.audio_url.strip()
    if any(char.isspace() for char in value) or "\\" in value:
        return None
    try:
        url = urlsplit(value)
        if url.scheme in {"http", "https"} and url.hostname and not url.username:
            return value
        if value.startswith(tts_service.AUDIO_URL_PREFIX):
            filename = value.removeprefix(tts_service.AUDIO_URL_PREFIX)
            if filename and "/" not in filename and not url.query and not url.fragment:
                path = tts_service.AUDIO_DIR / filename
                if path.is_file() and path.stat().st_size > 0:
                    return value
    except (ValueError, OSError):
        pass
    return None


def pick_content(poi, loc_map: dict, lang: str) -> dict:
    """Chọn nội dung hiển thị cho 1 điểm.

    Tầng 1: đúng ngôn ngữ yêu cầu
    Tầng 2: tiếng Anh
    Tầng 3: tiếng Việt gốc (luôn có, nên du khách không bao giờ gặp màn hình trống)
    """
    for code in (() if lang == SOURCE_LANG else (lang, FALLBACK_LANG)):
        loc = loc_map.get((poi.id, code))
        if loc is not None and loc.description:
            return {
                "name": loc.name,
                "description": loc.description,
                "audio_url": ready_audio(loc),
                "lang": code,
                "is_fallback": code != lang,
                "updated_at": getattr(loc, "updated_at", None),
            }

    vi = loc_map.get((poi.id, SOURCE_LANG))
    return {
        "name": poi.name_vi,
        "description": poi.description_vi,
        "audio_url": ready_audio(vi),
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


def save_manual(db: Session, poi_id: int, lang: str, name: str, description: str, admin, *, queued=True):
    """Lưu bản sửa tay và xếp hàng tạo lại audio trong cùng giao dịch."""
    if lang == SOURCE_LANG:
        raise AppError(400, "Tiếng Việt là nội dung gốc, hãy sửa trực tiếp ở điểm tham quan")
    language = localization_store.get_language(db, lang)
    if language is None or not language.is_active:
        raise AppError(400, f"Ngôn ngữ '{lang}' chưa được hỗ trợ")
    if poi_store.get(db, poi_id, lock=True) is None:
        raise AppError(404, "Không tìm thấy điểm tham quan")

    loc = localization_store.upsert(
        db, poi_id, lang, name, description,
        is_machine_translated=False, audio_status="processing", commit=False,
    )
    if queued:
        audio_task_store.enqueue(db, poi_id, [lang], translate=False, commit=False)
    audit_service.log(db, admin, "update_localization", "poi_localizations", loc.id)
    return loc
