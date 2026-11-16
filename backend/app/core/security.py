"""Băm mật khẩu (bcrypt) và tạo/kiểm tra token đăng nhập (JWT)."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings
from app.core.exceptions import AppError

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    """Biến mật khẩu thường thành chuỗi băm để lưu DB (không thể dịch ngược)."""
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        raise AppError(422, "Mật khẩu vượt quá 72 byte")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


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
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["sub", "exp"]})
        sub = payload["sub"]
        if not isinstance(sub, str) or len(sub) > 10 or not sub.isascii() or not sub.isdecimal():
            raise jwt.InvalidTokenError("Invalid account ID")
        if not 0 < int(sub) <= 2**31 - 1:
            raise jwt.InvalidTokenError("Invalid account ID")
        return payload
    except jwt.PyJWTError:
        raise AppError(401, "Token không hợp lệ hoặc đã hết hạn")
