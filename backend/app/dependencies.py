"""Các hàm dùng chung cho router qua Depends(...)."""
from typing import Optional

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import decode_token
from app.database import get_db
from app.stores import admin_store

# Swagger (/docs) sẽ hiện nút "Authorize": dán token vào là gọi được API admin
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """Đọc token trong header 'Authorization: Bearer <token>' và trả về admin hiện tại."""
    if credentials is None:
        raise AppError(401, "Chưa đăng nhập")
    payload = decode_token(credentials.credentials)
    admin = admin_store.get_by_id(db, int(payload["sub"]))
    if admin is None or not admin.is_active:
        raise AppError(401, "Tài khoản không hợp lệ")
    return admin


def require_super_admin(admin=Depends(get_current_admin)):
    if admin.role != "super_admin":
        raise AppError(403, "Chỉ Super Admin mới được thực hiện thao tác này")
    return admin
