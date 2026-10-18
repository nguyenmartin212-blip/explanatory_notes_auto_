from fastapi import APIRouter, Cookie, Depends, Header, Request, Response
from fastapi.responses import StreamingResponse

from app.auth.constants import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from app.auth.context import AuthContext, build_context, extract_token
from app.auth.cookies import clear_auth_cookies, set_auth_cookies
from app.auth.dependencies import get_auth_context, require_permission
from app.core.config import get_settings
from app.schemas.auth import LoginRequest, RefreshRequest
from app.services import audio_sse, auth_service
from app.stores import role_store

router = APIRouter(prefix="/admin", tags=["admin"])


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
