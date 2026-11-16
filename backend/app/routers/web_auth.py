"""Cookie authentication and admin account views consumed by the existing Web UI."""
import hashlib
from datetime import timedelta
from secrets import token_urlsafe
from threading import RLock

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.exceptions import AppError
from app.core.security import decode_token
from app.database import get_db, has_tables
from app.models import AdminUser
from app.models.web import WebRole, WebSession
from app.schemas.auth import LoginRequest
from app.routers.admin_pois import stream_audio_tasks
from app.services import auth_service
from app.stores.audio_task_store import utc_now

router = APIRouter(prefix="/admin", tags=["Web admin"])
ACCESS_COOKIE = "gth_web_access"
REFRESH_COOKIE = "gth_web_refresh"
BROWSER_PERMISSIONS = {"visitor:read", "analytics:read"}
_session_lock = RLock()
_temporary_sessions = {}


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest() if token else ""


def permissions(db, user):
    if user.role == "super_admin":
        return ["*"]
    role = db.get(WebRole, user.role) if has_tables(db, "web_roles") else None
    return role.permissions if role else sorted(BROWSER_PERMISSIONS)


def user_view(db, user):
    return {
        "user_id": str(user.id), "username": user.username, "role": user.role,
        "is_active": user.is_active, "created_at": user.created_at,
        "permissions": permissions(db, user),
        "features": {
            "roles": has_tables(db, "web_roles"),
            "visits": has_tables(db, "web_visits"),
            "device_usage": has_tables(db, "web_device_presence", "web_device_usage_sessions"),
            "audio_queue": has_tables(db, "audio_tasks"),
        },
    }


def current_user(request: Request, db: Session = Depends(get_db)):
    token_hash = digest(request.cookies.get(ACCESS_COOKIE))
    if not token_hash:
        raise AppError(401, "Phiên đăng nhập đã hết hạn")
    if has_tables(db, "web_sessions"):
        session = db.scalar(select(WebSession).where(WebSession.access_hash == token_hash))
    else:
        with _session_lock:
            session = next((entry for entry in _temporary_sessions.values() if entry.access_hash == token_hash), None)
    user = db.get(AdminUser, session.user_id) if session else None
    if (not user or not user.is_active or digest(user.password_hash) != session.password_hash
            or session.access_expires <= utc_now()):
        raise AppError(401, "Phiên đăng nhập đã hết hạn")
    return user


def require_web_permission(permission):
    def guard(user=Depends(current_user), db: Session = Depends(get_db)):
        allowed = permissions(db, user)
        if "*" not in allowed and permission not in allowed:
            raise AppError(403, "Tài khoản không có quyền truy cập")
        return user
    return guard


def new_session(request, response, db, user):
    access, refresh = token_urlsafe(32), token_urlsafe(32)
    now = utc_now()
    access_lifetime = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_lifetime = timedelta(days=7)
    session = WebSession(
        access_hash=digest(access), refresh_hash=digest(refresh), user_id=user.id,
        password_hash=digest(user.password_hash), access_expires=now + access_lifetime,
        refresh_expires=now + refresh_lifetime,
    )
    if has_tables(db, "web_sessions"):
        db.add(session)
        db.commit()
    else:
        with _session_lock:
            for key in [key for key, old in _temporary_sessions.items() if old.refresh_expires <= now]:
                del _temporary_sessions[key]
            _temporary_sessions[session.refresh_hash] = session
    for name, value, path, lifetime in (
        (ACCESS_COOKIE, access, "/", access_lifetime),
        (REFRESH_COOKIE, refresh, "/admin/auth", refresh_lifetime),
    ):
        response.set_cookie(name, value, path=path, max_age=int(lifetime.total_seconds()),
                            httponly=True, secure=request.url.scheme == "https", samesite="strict")


@router.post("/auth/login")
def login(data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    token = auth_service.login(db, data.username, data.password)
    user = db.get(AdminUser, int(decode_token(token)["sub"]))
    if has_tables(db, "web_sessions"):
        db.execute(delete(WebSession).where(WebSession.refresh_expires <= utc_now()))
    new_session(request, response, db, user)
    return {"user": user_view(db, user)}


@router.post("/auth/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token_hash = digest(request.cookies.get(REFRESH_COOKIE))
    persistent = has_tables(db, "web_sessions")
    if persistent:
        session = db.get(WebSession, token_hash, with_for_update=True)
    else:
        with _session_lock:
            session = _temporary_sessions.pop(token_hash, None)
    user = db.get(AdminUser, session.user_id) if session else None
    if (not user or not user.is_active or digest(user.password_hash) != session.password_hash
            or session.refresh_expires <= utc_now()):
        raise AppError(401, "Phiên đăng nhập đã hết hạn")
    if persistent:
        db.delete(session)
    new_session(request, response, db, user)
    return {"user": user_view(db, user)}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_hash = digest(request.cookies.get(REFRESH_COOKIE))
    access_hash = digest(request.cookies.get(ACCESS_COOKIE))
    if has_tables(db, "web_sessions"):
        db.execute(delete(WebSession).where(WebSession.refresh_hash == refresh_hash))
        db.execute(delete(WebSession).where(WebSession.access_hash == access_hash))
        db.commit()
    else:
        with _session_lock:
            _temporary_sessions.pop(refresh_hash, None)
            key = next((key for key, entry in _temporary_sessions.items() if entry.access_hash == access_hash), None)
            if key:
                del _temporary_sessions[key]
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/admin/auth")
    return {"logged_out": True}


@router.get("/auth/me")
def me(user=Depends(current_user), db: Session = Depends(get_db)):
    return user_view(db, user)


def super_admin(user=Depends(current_user)):
    if user.role != "super_admin":
        raise AppError(403, "Chỉ Super Admin mới được thực hiện thao tác này")
    return user


router.add_api_route(
    "/audio-tasks/stream", stream_audio_tasks, methods=["GET"], dependencies=[Depends(super_admin)]
)


@router.get("/users")
def users(db: Session = Depends(get_db), user=Depends(super_admin),
          limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0)):
    items = db.scalars(select(AdminUser).order_by(AdminUser.id).offset(offset).limit(limit)).all()
    return {"items": [user_view(db, item) for item in items], "offset": offset, "limit": limit,
            "total": db.scalar(select(func.count()).select_from(AdminUser))}


class RoleAssignment(BaseModel):
    role: str


@router.put("/users/{user_id}/role")
def assign_role(user_id: int, data: RoleAssignment, db: Session = Depends(get_db), user=Depends(super_admin)):
    if data.role not in {"admin", "super_admin"}:
        raise AppError(422, "Vai trò không hợp lệ")
    return user_view(db, auth_service.update_admin(db, user_id, data.role, None, user))


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), user=Depends(super_admin)):
    roles = list(db.scalars(select(WebRole).order_by(WebRole.name))) if has_tables(db, "web_roles") else []
    if not roles:
        roles = [WebRole(name="admin", description="Quản trị vận hành", permissions=sorted(BROWSER_PERMISSIONS))]
    return [
        {"name": "super_admin", "description": "Toàn quyền", "permissions": ["*"], "is_default": True},
        *[role_view(role) for role in roles],
    ]


class RoleUpdate(BaseModel):
    permissions: list[str]
    description: str = Field(default="", max_length=500)


def role_view(role):
    return {"name": role.name, "description": role.description,
            "permissions": role.permissions, "is_default": True}


@router.put("/roles/{name}")
def update_role(name: str, data: RoleUpdate, db: Session = Depends(get_db), user=Depends(super_admin)):
    if not has_tables(db, "web_roles"):
        raise AppError(503, "Schema hiện tại chưa có bảng tùy chỉnh quyền Web.")
    role = db.get(WebRole, name)
    if not role:
        if name != "admin":
            raise AppError(404, "Vai trò không thể chỉnh sửa")
        role = WebRole(name=name)
        db.add(role)
    if not set(data.permissions) <= BROWSER_PERMISSIONS:
        raise AppError(422, "Vai trò admin hỗ trợ quyền xem lượt khách và thống kê thiết bị")
    role.permissions = sorted(set(data.permissions))
    role.description = data.description
    db.commit()
    return role_view(role)
