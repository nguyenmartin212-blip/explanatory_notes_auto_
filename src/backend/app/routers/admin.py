from fastapi import APIRouter, Cookie, Depends, Header, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.constants import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from app.auth.context import AuthContext, build_context, extract_token
from app.auth.cookies import clear_auth_cookies, set_auth_cookies
from app.auth.dependencies import get_auth_context, require_permission
from app.core.config import get_settings
from app.schemas.auth import LoginRequest, RefreshRequest
from app.services import audio_sse, auth_service, role_service
from app.stores import admin_user_store, role_store, visitor_visit_store

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
    user = await role_service.assign_role(request.app.state.db, ctx, user_id, payload.role)
    return _public_admin_user(user)
