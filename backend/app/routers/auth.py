"""UC-13 Đăng nhập và UC-12 Quản lý tài khoản quản trị."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin, require_super_admin
from app.schemas.auth import (AdminCreate, AdminOut, AdminUpdate, LoginRequest, PasswordChange,
                              PasswordReset, TokenResponse)
from app.schemas.common import MessageResponse
from app.services import auth_service
from app.stores import admin_store

router = APIRouter(prefix="/api/v1/admin/auth", tags=["Admin - Đăng nhập & tài khoản"])


# ---------------------------------------------------------------- UC-13
@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """Đăng nhập, nhận token. Dùng token này bấm nút Authorize ở trang /docs."""
    token = auth_service.login(db, data.username, data.password)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=AdminOut)
def me(admin=Depends(get_current_admin)):
    """Thông tin tài khoản đang đăng nhập."""
    return admin


@router.post("/change-password", response_model=MessageResponse)
def change_password(data: PasswordChange, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """Admin tự đổi mật khẩu của mình."""
    auth_service.change_own_password(db, admin, data.old_password, data.new_password)
    return MessageResponse(detail="Đã đổi mật khẩu")


# ---------------------------------------------------------------- UC-12 (chỉ Super Admin)
@router.get("/users", response_model=list[AdminOut])
def list_admins(db: Session = Depends(get_db), _=Depends(require_super_admin)):
    """Danh sách tài khoản quản trị."""
    return admin_store.list_all(db)


@router.post("/users", response_model=AdminOut, status_code=201)
def create_admin(data: AdminCreate, db: Session = Depends(get_db), super_admin=Depends(require_super_admin)):
    """Tạo tài khoản quản trị mới."""
    return auth_service.create_admin(db, data.username, data.password, data.role, super_admin)


@router.patch("/users/{admin_id}", response_model=AdminOut)
def update_admin(admin_id: int, data: AdminUpdate, db: Session = Depends(get_db),
                 super_admin=Depends(require_super_admin)):
    """Đổi vai trò hoặc khóa / mở khóa tài khoản (không áp dụng cho chính mình)."""
    return auth_service.update_admin(db, admin_id, data.role, data.is_active, super_admin)


@router.post("/users/{admin_id}/reset-password", response_model=MessageResponse)
def reset_password(admin_id: int, data: PasswordReset, db: Session = Depends(get_db),
                   super_admin=Depends(require_super_admin)):
    """Đặt lại mật khẩu cho một tài khoản."""
    auth_service.reset_password(db, admin_id, data.new_password, super_admin)
    return MessageResponse(detail="Đã đặt lại mật khẩu")


@router.delete("/users/{admin_id}", status_code=204)
def delete_admin(admin_id: int, db: Session = Depends(get_db), super_admin=Depends(require_super_admin)):
    """Xóa tài khoản (không xóa được chính mình, và phải còn ít nhất 1 Super Admin)."""
    auth_service.delete_admin(db, admin_id, super_admin)
