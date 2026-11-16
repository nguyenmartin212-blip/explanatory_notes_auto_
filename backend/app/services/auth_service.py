from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import create_access_token, hash_password, verify_password
from app.services import audit_service
from app.stores import admin_store


# ------------------------------------------------------------ UC-13 Đăng nhập
def login(db: Session, username: str, password: str) -> str:
    """Đúng tài khoản + mật khẩu thì trả về token. Thông báo lỗi cố ý chung chung."""
    admin = admin_store.get_by_username(db, username)
    if admin is None or not admin.is_active or not verify_password(password, admin.password_hash):
        raise AppError(401, "Sai tài khoản hoặc mật khẩu")
    return create_access_token(admin.id, admin.role)


def change_own_password(db: Session, admin, old_password: str, new_password: str) -> None:
    if not verify_password(old_password, admin.password_hash):
        raise AppError(400, "Mật khẩu cũ không đúng")
    admin_store.update(db, admin, {"password_hash": hash_password(new_password)})
    audit_service.log(db, admin, "change_own_password", "admin_users", admin.id)


# ------------------------------------------------- UC-12 Quản lý tài khoản admin
def _get_or_404(db: Session, admin_id: int):
    target = admin_store.get_by_id(db, admin_id)
    if target is None:
        raise AppError(404, "Không tìm thấy tài khoản")
    return target


def _ensure_another_super_admin(db: Session) -> None:
    """Hệ thống luôn phải còn ít nhất 1 Super Admin đang hoạt động."""
    if admin_store.count_active_super_admins(db) <= 1:
        raise AppError(400, "Phải luôn còn ít nhất một Super Admin đang hoạt động")


def create_admin(db: Session, username: str, password: str, role: str, by_admin=None):
    if admin_store.get_by_username(db, username) is not None:
        raise AppError(400, "Tên đăng nhập đã tồn tại")
    admin = admin_store.create(db, username, hash_password(password), role)
    audit_service.log(db, by_admin, "create_admin", "admin_users", admin.id)
    return admin


def update_admin(db: Session, target_id: int, role, is_active, by_admin):
    """Đổi vai trò / khóa / mở khóa tài khoản."""
    target = _get_or_404(db, target_id)
    if target.id == by_admin.id:
        raise AppError(400, "Không thể tự đổi vai trò hoặc tự khóa chính mình")

    changes = {}
    if role is not None and role != target.role:
        changes["role"] = role
    if is_active is not None and is_active != target.is_active:
        changes["is_active"] = is_active
    if not changes:
        return target

    # Hạ quyền hoặc khóa một Super Admin đang hoạt động -> phải còn người khác thay thế
    is_active_super = target.role == "super_admin" and target.is_active
    will_lose_it = changes.get("role", target.role) != "super_admin" or changes.get("is_active", True) is False
    if is_active_super and will_lose_it:
        _ensure_another_super_admin(db)

    admin_store.update(db, target, changes)
    audit_service.log(db, by_admin, "update_admin", "admin_users", target.id)
    return target


def reset_password(db: Session, target_id: int, new_password: str, by_admin) -> None:
    target = _get_or_404(db, target_id)
    admin_store.update(db, target, {"password_hash": hash_password(new_password)})
    audit_service.log(db, by_admin, "reset_password", "admin_users", target.id)


def delete_admin(db: Session, target_id: int, by_admin) -> None:
    target = _get_or_404(db, target_id)
    if target.id == by_admin.id:
        raise AppError(400, "Không thể tự xóa chính mình")
    if target.role == "super_admin" and target.is_active:
        _ensure_another_super_admin(db)
    admin_store.delete(db, target)
    audit_service.log(db, by_admin, "delete_admin", "admin_users", target_id)
