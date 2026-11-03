"""Băm mật khẩu (bcrypt) và tạo/kiểm tra token đăng nhập (JWT)."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings
from app.core.exceptions import AppError

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    """Biến mật khẩu thường thành chuỗi băm để lưu DB (không thể dịch ngược)."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise AppError(401, "Token không hợp lệ hoặc đã hết hạn")
