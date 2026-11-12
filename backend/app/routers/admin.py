from typing import Literal

from fastapi import APIRouter, Cookie, Depends, Header, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.constants import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from app.auth.context import AuthContext, authorize, build_context, extract_token
from app.auth.cookies import clear_auth_cookies, set_auth_cookies
from app.auth.passwords import default_hasher
from app.auth.permissions import SUPER_ADMIN_ROLE
from app.auth.dependencies import get_auth_context, require_permission
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError, PermissionDenied
from app.schemas.auth import LoginRequest, RefreshRequest
from app.schemas.content import SUPPORTED_LANGUAGES, LocalizationIn, PoiCreate, PoiUpdate
from app.services import account_service, audio_sse, auth_service, role_service, content_service
from app.stores import admin_user_store, role_store, visitor_visit_store, poi_store

router = APIRouter(prefix="/admin", tags=["admin"])


class RoleUpdateRequest(BaseModel):
    permissions: list[str] | None = None
    description: str | None = Field(default=None, max_length=500)


class UserRoleUpdateRequest(BaseModel):
    role: str = Field(min_length=2, max_length=40, pattern=r"^[a-z][a-z0-9_]{1,39}$")


def _public_admin_user(user: dict) -> dict:
    return {
        key: user[key]
        for key in (
            "user_id",
            "username",
            "role",
            "is_active",
            "is_poi_owner_verified",
            "owner_status",
            "created_at",
            "last_login_at",
        )
        if key in user
    }


# --------------------------------------------------------------------------- #
# Authentication  (the refresh cookie is scoped to /admin/auth)
# --------------------------------------------------------------------------- #
@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response):
    settings = get_settings()
    user, session = await auth_service.login(request.app.state.db, settings, body.username, body.password)
    set_auth_cookies(response, settings, session)
    role = await role_store.get(request.app.state.db, user.get("role"))
    ctx = build_context(user, role)
    return {**auth_service.token_response(session), "user": auth_service.user_view(ctx)}


@router.post("/auth/refresh")
async def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
):
    settings = get_settings()
    state = request.app.state
    token = (body.refresh_token if body else None) or refresh_cookie
    user, session = await auth_service.refresh_session(state.db, state.redis, settings, token)
    set_auth_cookies(response, settings, session)
    return auth_service.token_response(session)


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    authorization: str | None = Header(default=None),
    access_cookie: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
):
    settings = get_settings()
    revoked = await auth_service.logout(
        request.app.state.redis,
        settings,
        access_token=extract_token(authorization, access_cookie),
        refresh_token=(body.refresh_token if body else None) or refresh_cookie,
    )
    clear_auth_cookies(response, settings)
    return {"logged_out": True, "revoked_tokens": revoked}


@router.get("/auth/me")
async def me(ctx: AuthContext = Depends(get_auth_context)):
    return auth_service.user_view(ctx)


# --------------------------------------------------------------------------- #
# Audio task progress (SSE)
# --------------------------------------------------------------------------- #
@router.get("/audio-tasks/stream")
async def audio_tasks_stream(request: Request, ctx: AuthContext = Depends(require_permission("audio:manage"))):
    """Server-Sent Events: audio task progress (snapshot, then every change)."""
    settings = get_settings()
    stream = audio_sse.event_stream(
        request.app.state.db,
        is_disconnected=request.is_disconnected,
        poll_seconds=settings.audio_sse_poll_seconds,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/visitor-visits")
async def list_visitor_visits(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    poi_id: str | None = Query(default=None, min_length=2, max_length=81, pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{1,80}$"),
    ctx: AuthContext = Depends(require_permission("visitor:read")),
):
    """List anonymous QR visits for roles explicitly granted visitor:read."""
    visits, total = await visitor_visit_store.list_visits(
        request.app.state.db,
        limit=limit,
        offset=offset,
        poi_id=poi_id,
    )
    return {"items": visits, "total": total, "limit": limit, "offset": offset}


@router.get("/roles")
async def list_roles(
    request: Request,
    ctx: AuthContext = Depends(require_permission("role:read")),
):
    return await role_service.list_roles(request.app.state.db, ctx)


@router.put("/roles/{name}")
async def update_role(
    name: str,
    payload: RoleUpdateRequest,
    request: Request,
    ctx: AuthContext = Depends(require_permission("role:update")),
):
    return await role_service.update_role(
        request.app.state.db,
        ctx,
        name,
        permissions=payload.permissions,
        description=payload.description,
    )


@router.get("/users")
async def list_users(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: AuthContext = Depends(require_permission("user:read")),
):
    users, total = await admin_user_store.list_users(request.app.state.db, limit=limit, offset=offset)
    return {"items": [_public_admin_user(user) for user in users], "total": total, "limit": limit, "offset": offset}


@router.put("/users/{user_id}/role")
async def assign_user_role(
    user_id: str,
    payload: UserRoleUpdateRequest,
    request: Request,
    ctx: AuthContext = Depends(require_permission("user:update")),
):
    state = request.app.state
    async with account_service.account_lock(state.redis):
        actor = await account_service.load_account(state.db, ctx.user_id)
        if not actor.get("is_active", True):
            raise PermissionDenied("forbidden", "Account is disabled")
        current_ctx = build_context(actor, await role_store.get(state.db, actor.get("role")))
        authorize(current_ctx, ("user:update",))
        user = await role_service.assign_role(state.db, current_ctx, user_id, payload.role)
        await account_service.audit(state.db, ctx, "account.role_assigned", user_id)
    return _public_admin_user(user)


# --------------------------------------------------------------------------- #
# Account lifecycle
# --------------------------------------------------------------------------- #
class AccountCreate(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_.-]{2,100}$")
    password: str = Field(min_length=8, max_length=72)
    role: str = Field(default="admin", min_length=2, max_length=40)


class AccountState(BaseModel):
    is_active: bool


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=72)


class PasswordChange(PasswordReset):
    old_password: str = Field(min_length=1, max_length=256)


async def require_super_admin(ctx: AuthContext = Depends(get_auth_context)):
    if ctx.role_name != SUPER_ADMIN_ROLE:
        raise PermissionDenied("forbidden", "Only a super admin can manage accounts")
    return ctx


@router.post("/auth/change-password")
async def change_password(
    data: PasswordChange, request: Request, response: Response, ctx: AuthContext = Depends(get_auth_context)
):
    await account_service.change_password(request.app.state.db, ctx, data.old_password, data.new_password)
    clear_auth_cookies(response, get_settings())
    return {"detail": "Password updated; sign in again"}


@router.post("/users", status_code=201)
async def create_account(data: AccountCreate, request: Request, ctx: AuthContext = Depends(require_super_admin)):
    password_hash = await default_hasher.hash(data.password)
    state = request.app.state
    async with account_service.account_lock(state.redis):
        await account_service.require_current_super_admin(state.db, ctx)
        if await role_store.get(state.db, data.role) is None:
            raise NotFoundError("Role not found")
        user = await admin_user_store.create_user(
            state.db, username=data.username, password_hash=password_hash, role=data.role
        )
        await account_service.audit(state.db, ctx, "account.created", user["user_id"])
    return _public_admin_user(user)


@router.patch("/users/{user_id}")
async def set_account_state(
    user_id: str, data: AccountState, request: Request, ctx: AuthContext = Depends(require_super_admin)
):
    state = request.app.state
    async with account_service.account_lock(state.redis):
        await account_service.require_current_super_admin(state.db, ctx)
        user = await account_service.load_account(state.db, user_id)
        if user["is_active"] != data.is_active:
            if not data.is_active:
                await account_service.require_other_super_admin(state.db, user)
            await admin_user_store.update_account(state.db, user_id, {"is_active": data.is_active})
            await account_service.audit(state.db, ctx, "account.activation_changed", user_id)
            user = await account_service.load_account(state.db, user_id)
    return _public_admin_user(user)


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str, data: PasswordReset, request: Request, ctx: AuthContext = Depends(require_super_admin)
):
    password_hash = await default_hasher.hash(data.new_password)
    state = request.app.state
    async with account_service.account_lock(state.redis):
        await account_service.require_current_super_admin(state.db, ctx)
        await account_service.load_account(state.db, user_id)
        await admin_user_store.update_account(state.db, user_id, {"password_hash": password_hash})
        await account_service.audit(state.db, ctx, "account.password_reset", user_id)
    return {"detail": "Password reset"}


@router.delete("/users/{user_id}", status_code=204)
async def delete_account(user_id: str, request: Request, ctx: AuthContext = Depends(require_super_admin)):
    state = request.app.state
    async with account_service.account_lock(state.redis):
        await account_service.require_current_super_admin(state.db, ctx)
        if user_id == ctx.user_id:
            raise ConflictError("You cannot delete your own account")
        user = await account_service.load_account(state.db, user_id)
        await account_service.require_other_super_admin(state.db, user)
        await admin_user_store.delete_user(state.db, user_id)
        await account_service.audit(state.db, ctx, "account.deleted", user_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# Minimal content CMS endpoints. Activation enforces standard audio readiness.
# These shared admin endpoints are for admins, not POI owners. Per-owner editing
# requires object ownership checks and should be implemented separately.
# --------------------------------------------------------------------------- #
def require_admin_content_permission(permission: str):
    async def guard(ctx: AuthContext = Depends(require_permission(permission))) -> AuthContext:
        if ctx.role_name not in {"admin", "super_admin"}:
            raise PermissionDenied("forbidden", "Only system administrators can manage all POIs")
        return ctx

    return guard

@router.get("/pois")
async def list_content_pois(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    ctx: AuthContext = Depends(require_admin_content_permission("poi:read_draft")),
):
    items, total = await poi_store.list_page(request.app.state.db, limit=limit, offset=offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/pois/{poi_id}")
async def get_content_poi(
    poi_id: str,
    request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("poi:read_draft")),
):
    return await content_service.get_admin_view(request.app.state.db, poi_id)


@router.post("/pois", status_code=201)
async def create_content_poi(
    payload: PoiCreate,
    request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("poi:create")),
):
    state = request.app.state
    item = await content_service.create_poi(state.db, get_settings(), payload)
    if "vi" in payload.localizations:
        queue_languages(state, item["poi_id"], SUPPORTED_LANGUAGES)
    await account_service.audit(state.db, ctx, "poi.created", item["poi_id"])
    return item


@router.patch("/pois/{poi_id}")
async def update_content_poi(
    poi_id: str,
    payload: PoiUpdate,
    request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("poi:update")),
):
    state = request.app.state
    item = await content_service.update_poi(state.db, get_settings(), poi_id, payload)
    if payload.localizations and "vi" in payload.localizations:
        queue_languages(state, poi_id, SUPPORTED_LANGUAGES)
    await account_service.audit(state.db, ctx, "poi.updated", poi_id)
    return item


@router.post("/pois/{poi_id}/activate")
async def activate_content_poi(
    poi_id: str,
    request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("poi:activate")),
):
    item = await content_service.activate_poi(request.app.state.db, poi_id)
    await account_service.audit(request.app.state.db, ctx, "poi.activated", poi_id)
    return item


@router.delete("/pois/{poi_id}", status_code=204)
async def delete_content_poi(
    poi_id: str,
    request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("poi:delete")),
):
    await content_service.delete_poi(request.app.state.db, get_settings(), poi_id)
    await account_service.audit(request.app.state.db, ctx, "poi.deleted", poi_id)
    return Response(status_code=204)


Language = Literal["vi", "en", "zh", "ja", "ko"]
AudioAction = Literal["pause", "resume", "cancel", "retry"]


class Activation(BaseModel):
    is_active: bool


class GenerateAudio(BaseModel):
    langs: list[Language] | None = Field(default=None, min_length=1, max_length=5)


def queue_languages(state, poi_id, languages):
    return {lang: state.localization.enqueue_admin(poi_id, lang) for lang in dict.fromkeys(languages)}


@router.patch("/pois/{poi_id}/activation")
async def set_activation(
    poi_id: str, data: Activation, request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("poi:activate")),
):
    if data.is_active:
        return await activate_content_poi(poi_id, request, ctx)
    db = request.app.state.db
    item = await content_service.deactivate_poi(db, poi_id)
    await account_service.audit(db, ctx, "poi.deactivated", poi_id)
    return item


@router.get("/pois/{poi_id}/localizations")
async def list_localizations(
    poi_id: str, request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("localization:read")),
):
    item = await content_service.get_admin_view(request.app.state.db, poi_id)
    return item["localizations"]


@router.put("/pois/{poi_id}/localizations/{lang}")
async def update_localization(
    poi_id: str, lang: Language, data: LocalizationIn, request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("localization:update")),
):
    state = request.app.state
    await content_service.save_localization(state.db, get_settings(), poi_id, lang, data)
    if lang == "vi":
        queue_languages(state, poi_id, SUPPORTED_LANGUAGES)
    await account_service.audit(state.db, ctx, "poi.localization_updated", poi_id)
    item = await content_service.get_admin_view(state.db, poi_id)
    return item["localizations"][lang]


@router.post("/pois/{poi_id}/generate-audio", status_code=202)
async def generate_audio(
    poi_id: str, request: Request, data: GenerateAudio | None = None,
    ctx: AuthContext = Depends(require_admin_content_permission("audio:generate")),
):
    state = request.app.state
    if not await poi_store.get(state.db, poi_id):
        raise NotFoundError("POI not found")
    statuses = queue_languages(state, poi_id, data.langs if data and data.langs else SUPPORTED_LANGUAGES)
    await account_service.audit(state.db, ctx, "poi.audio_requested", poi_id)
    return {"poi_id": poi_id, "languages": statuses}


@router.get("/audio-tasks")
async def list_audio_tasks(
    request: Request, limit: int = Query(50, ge=1, le=200),
    ctx: AuthContext = Depends(require_admin_content_permission("audio:manage")),
):
    return await request.app.state.audio_tasks.list_tasks(limit)


@router.post("/audio-tasks/{task_id}/{action}")
async def change_audio_task(
    task_id: str, action: AudioAction, request: Request,
    ctx: AuthContext = Depends(require_admin_content_permission("audio:manage")),
):
    state = request.app.state
    manager = state.audio_tasks
    handler = {"pause": manager.pause, "resume": manager.resume,
               "cancel": manager.cancel, "retry": manager.retry}[action]
    task = await handler(task_id)
    await account_service.audit(state.db, ctx, f"audio.{action}", task_id)
    return task
