"""Các lỗi tự định nghĩa."""


class AppError(Exception):
    """Lỗi nghiệp vụ. Service ném ra, main.py sẽ đổi thành phản hồi JSON
    dạng {"detail": "..."} kèm mã HTTP tương ứng (400, 401, 404...)."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class TranslateError(Exception):
    """Dịch thất bại (mất mạng, bị giới hạn...)."""


class TTSError(Exception):
    """Sinh giọng đọc thất bại."""
