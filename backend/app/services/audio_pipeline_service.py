"""Quy trình: lấy mô tả tiếng Việt -> dịch -> sinh MP3 -> lưu vào bảng poi_localizations.

Worker gọi generate_for_poi với session DB riêng.
Mỗi ngôn ngữ xử lý độc lập: 1 ngôn ngữ lỗi không làm hỏng các ngôn ngữ khác.
"""
import logging
from typing import Optional

from app.core.constants import SOURCE_LANG
from app.core.exceptions import TranslateError, TTSError
from app.database import SessionLocal
from app.services import translate_service, tts_service
from app.stores import localization_store, poi_store

logger = logging.getLogger(__name__)


def _revision(loc):
    if loc is None:
        return None
    return loc.name, loc.description, loc.is_machine_translated, loc.updated_at


def _process_language(db, poi_id, code, voice, translate: bool) -> None:
    poi = poi_store.get(db, poi_id)
    if poi is None:
        return
    source = (poi.name_vi, poi.description_vi)
    existing = _revision(localization_store.get(db, poi_id, code))
    db.rollback()

    needs_translation = code != SOURCE_LANG and (existing is None or (translate and existing[2]))
    try:
        if code == SOURCE_LANG:
            name, description = source
            machine = False
        elif needs_translation:
            name, description = (translate_service.translate_text(text, code) for text in source)
            machine = True
        else:
            name, description, machine, _ = existing
    except TranslateError:
        _finish_audio(db, poi_id, code, source, existing, None, "failed")
        raise

    # Chỉ lưu nếu dữ liệu chưa bị thay đổi trong lúc gọi dịch vụ dịch.
    if _current_input(db, poi_id, code, source, existing) is None:
        return
    loc = localization_store.upsert(db, poi_id, code, name, description, machine, "processing")
    saved = _revision(loc)
    db.rollback()

    try:
        result = tts_service.make_audio(f"{name}. {description}", code, voice)
    except TTSError:
        _finish_audio(db, poi_id, code, source, saved, None, "failed")
        raise
    _finish_audio(db, poi_id, code, source, saved, result, "ready")


def _current_input(db, poi_id, code, source, revision):
    poi = poi_store.get(db, poi_id, lock=True)
    if poi is not None and (poi.name_vi, poi.description_vi) == source:
        loc = localization_store.get(db, poi_id, code, lock=True)
        if _revision(loc) == revision:
            return poi, loc
    db.rollback()
    return None


def _finish_audio(db, poi_id, code, source, revision, result, status):
    current = _current_input(db, poi_id, code, source, revision)
    if current and current[1] is not None:
        url, content_hash = result if result else (None, None)
        localization_store.set_audio(db, current[1], url, status, content_hash)
    else:
        db.rollback()


def generate_for_poi(poi_id: int, langs: Optional[list] = None, translate: bool = True, *, on_progress=None):
    """Sinh bản dịch + audio cho 1 điểm.
    langs=None -> tất cả ngôn ngữ đang bật. translate=False -> giữ bản dịch hiện có, chỉ sinh lại audio."""
    with SessionLocal() as db:
        poi = poi_store.get(db, poi_id)
        if poi is None:
            logger.warning("Không tìm thấy POI %s để sinh audio", poi_id)
            return False

        languages = [(lg.code, lg.tts_voice) for lg in localization_store.list_active_languages(db)
                     if langs is None or lg.code in langs]
        db.rollback()

        successful = bool(languages)
        for index, (code, voice) in enumerate(languages, 1):
            try:
                _process_language(db, poi_id, code, voice, translate)
            except (TranslateError, TTSError) as e:
                logger.error("POI %s [%s] lỗi: %s", poi_id, code, e)
                successful = False
            except Exception as e:  # lỗi bất ngờ cũng không được làm hỏng ngôn ngữ khác
                logger.exception("POI %s [%s] lỗi không mong đợi: %s", poi_id, code, e)
                db.rollback()
                successful = False

            if on_progress:
                on_progress(index * 100 // len(languages))
        return successful
