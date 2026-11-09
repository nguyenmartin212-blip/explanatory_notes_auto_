"""Dịch văn bản tiếng Việt sang ngôn ngữ khác bằng deep-translator (miễn phí)."""
import time

from app.core.constants import SOURCE_LANG, TRANSLATE_CODES
from app.core.exceptions import TranslateError

MAX_CHUNK = 4000  # Google Translate giới hạn ~5000 ký tự mỗi lần


def _split_text(text: str, limit: int = MAX_CHUNK) -> list[str]:
    """Văn bản dài thì cắt thành nhiều đoạn theo câu."""
    if len(text) <= limit:
        return [text]
    chunks, current = [], ""
    for sentence in text.split(". "):
        piece = sentence + ". "
        if current and len(current) + len(piece) > limit:
            chunks.append(current.strip())
            current = ""
        current += piece
    if current.strip():
        chunks.append(current.strip())
    return chunks


def translate_text(text: str, target_lang: str) -> str:
    """Dịch text từ tiếng Việt sang target_lang. Lỗi thì ném TranslateError."""
    if target_lang == SOURCE_LANG:
        return text

    try:
        from deep_translator import GoogleTranslator  # nạp khi cần
    except ImportError:
        raise TranslateError("Chưa cài deep-translator (pip install deep-translator)")

    code = TRANSLATE_CODES.get(target_lang, target_lang)
    translator = GoogleTranslator(source=SOURCE_LANG, target=code)

    parts = []
    for chunk in _split_text(text):
        result = None
        last_error = None
        for _ in range(3):  # thử lại tối đa 3 lần
            try:
                result = translator.translate(chunk)
                break
            except Exception as e:  # mất mạng, bị giới hạn...
                last_error = e
                time.sleep(1)
        if not result:
            raise TranslateError(f"Dịch sang '{target_lang}' thất bại: {last_error}")
        parts.append(result)
    return " ".join(parts)
