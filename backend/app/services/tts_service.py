"""Chuyển văn bản thành file MP3 bằng edge-tts (miễn phí, cần internet).

CACHE: tên file = MD5(ngôn ngữ + giọng + nội dung). Cùng nội dung thì dùng lại file cũ,
không gọi edge-tts lần nữa.
"""
import asyncio
import hashlib
import os
from pathlib import Path

from app.core.constants import MAX_TTS_CHARS
from app.core.exceptions import TTSError

AUDIO_DIR = Path(__file__).resolve().parent.parent / "static" / "audio"
AUDIO_URL_PREFIX = "/static/audio/"


async def _save_mp3(text: str, voice: str, path: str) -> None:
    import edge_tts  # nạp khi cần
    await edge_tts.Communicate(text, voice).save(path)


def make_audio(text: str, lang_code: str, voice: str):
    """Trả về (audio_url, content_hash). Lỗi thì ném TTSError."""
    if not voice:
        raise TTSError(f"Ngôn ngữ '{lang_code}' chưa cấu hình giọng đọc (cột tts_voice)")
    if len(text) > MAX_TTS_CHARS:
        raise TTSError(f"Văn bản quá dài ({len(text)} ký tự, tối đa {MAX_TTS_CHARS})")

    content_hash = hashlib.md5(f"{lang_code}|{voice}|{text}".encode("utf-8")).hexdigest()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    final_path = AUDIO_DIR / f"{content_hash}.mp3"

    if not final_path.exists():  # chưa có trong cache thì mới sinh
        tmp_path = AUDIO_DIR / f"{content_hash}.tmp"
        try:
            asyncio.run(_save_mp3(text, voice, str(tmp_path)))
            os.replace(tmp_path, final_path)  # sinh xong mới đổi tên -> không bao giờ có file dở dang
        except Exception as e:
            if tmp_path.exists():
                tmp_path.unlink()
            raise TTSError(f"Sinh audio thất bại: {e}")

    return f"{AUDIO_URL_PREFIX}{content_hash}.mp3", content_hash


def audio_size(audio_url):
    """Dung lượng file audio (byte), hoặc None nếu không có file."""
    if not audio_url or not audio_url.startswith(AUDIO_URL_PREFIX):
        return None
    path = AUDIO_DIR / Path(audio_url).name
    return path.stat().st_size if path.exists() else None


def delete_audio_file(audio_url) -> None:
    """Xóa file mp3 theo đường dẫn URL (bỏ qua nếu không tồn tại)."""
    if not audio_url or not audio_url.startswith(AUDIO_URL_PREFIX):
        return
    path = AUDIO_DIR / Path(audio_url).name
    if path.exists():
        path.unlink()
