"""Quy trình: lấy mô tả tiếng Việt -> dịch -> sinh MP3 -> lưu vào bảng poi_localizations.

Hàm generate_for_poi chạy NỀN (BackgroundTasks), nên tự mở session DB riêng.
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


def _process_language(db, poi, language, translate: bool) -> None:
    code = language.code
    existing = localization_store.get(db, poi.id, code)

    # --- Bước 1: xác định tên + mô tả của ngôn ngữ này ---
    if code == SOURCE_LANG:
        name, description, machine = poi.name_vi, poi.description_vi, False
    elif translate or existing is None:
        name = translate_service.translate_text(poi.name_vi, code)
        description = translate_service.translate_text(poi.description_vi, code)
        machine = True
    else:  # giữ nguyên bản dịch (ví dụ admin vừa sửa tay)
        name, description, machine = existing.name, existing.description, existing.is_machine_translated

    # --- Bước 2: lưu bản dịch, đánh dấu đang xử lý ---
    loc = localization_store.upsert(db, poi.id, code, name, description, machine, "processing")

    # --- Bước 3: sinh audio (có cache theo nội dung) ---
    audio_url, content_hash = tts_service.make_audio(f"{name}. {description}", code, language.tts_voice)
    localization_store.set_audio(db, loc, audio_url, "ready", content_hash)


def generate_for_poi(poi_id: int, langs: Optional[list] = None, translate: bool = True) -> None:
    """Sinh bản dịch + audio cho 1 điểm.
    langs=None -> tất cả ngôn ngữ đang bật. translate=False -> giữ bản dịch hiện có, chỉ sinh lại audio."""
    with SessionLocal() as db:
        poi = poi_store.get(db, poi_id)
        if poi is None:
            logger.warning("Không tìm thấy POI %s để sinh audio", poi_id)
            return

        languages = localization_store.list_active_languages(db)
        if langs:
            languages = [lg for lg in languages if lg.code in langs]

        for language in languages:
            try:
                _process_language(db, poi, language, translate)
                logger.info("POI %s [%s]: audio sẵn sàng", poi_id, language.code)
            except (TranslateError, TTSError) as e:
                logger.error("POI %s [%s] lỗi: %s", poi_id, language.code, e)
                _mark_failed(db, poi_id, language.code)
            except Exception as e:  # lỗi bất ngờ cũng không được làm hỏng ngôn ngữ khác
                logger.exception("POI %s [%s] lỗi không mong đợi: %s", poi_id, language.code, e)
                db.rollback()
                _mark_failed(db, poi_id, language.code)


def _mark_failed(db, poi_id: int, code: str) -> None:
    loc = localization_store.get(db, poi_id, code)
    if loc is not None:
        localization_store.set_audio(db, loc, None, "failed", None)
