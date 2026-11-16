"""Các hàm dùng chung cho router qua Depends(...)."""
from typing import Optional

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import decode_token
from app.database import get_db
from app.stores import admin_store

# Swagger (/docs) sẽ hiện nút "Authorize": dán token vào là gọi được API admin
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """Đọc token trong header 'Authorization: Bearer <token>' và trả về admin hiện tại."""
    if credentials is None:
        from app.routers.web_auth import current_user

        return current_user(request, db)
    payload = decode_token(credentials.credentials)
    admin = admin_store.get_by_id(db, int(payload["sub"]))
    if admin is None or not admin.is_active:
        raise AppError(401, "Tài khoản không hợp lệ")
    return admin


def require_super_admin(admin=Depends(get_current_admin)):
    if admin.role != "super_admin":
        raise AppError(403, "Chỉ Super Admin mới được thực hiện thao tác này")
    return admin


def require_admin_permission(permission: str):
    def guard(admin=Depends(get_current_admin), db: Session = Depends(get_db)):
        from app.routers.web_auth import permissions

        allowed = permissions(db, admin)
        if "*" not in allowed and permission not in allowed:
            raise AppError(403, "Tài khoản không có quyền truy cập")
        return admin
    return guard
