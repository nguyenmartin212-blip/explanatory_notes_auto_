"""FastAPI dependencies: authentication and the permission guard.

    @router.delete("/pois/{poi_id}")
    async def delete_poi(poi_id: str, ctx: AuthContext = Depends(require_permission("poi:delete"))):
        ...
"""

from __future__ import annotations

from fastapi import Cookie, Depends, Header, Request

from app.auth.constants import ACCESS_COOKIE_NAME
from app.auth.context import AuthContext, authorize, authorize_verified_owner, extract_token
from app.core.config import get_settings
from app.core.errors import AuthenticationError
from app.services import auth_service


async def get_auth_context(
    request: Request,
    authorization: str | None = Header(default=None),
    access_cookie: str | None = Cookie(default=None, alias=ACCESS_COOKIE_NAME),
) -> AuthContext:
    """Bearer header first, then the httpOnly cookie."""
    token = extract_token(authorization, access_cookie)
    if not token:
        raise AuthenticationError("not_authenticated", "Authentication required")
    state = request.app.state
    return await auth_service.authenticate(state.db, state.redis, get_settings(), token)


def require_permission(*permissions: str):
    """Dependency factory: the caller must hold every listed permission
    (and, for a poi_owner, be verified)."""
    if not permissions:
        raise ValueError("require_permission needs at least one permission")

    async def guard(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        authorize(ctx, permissions)
        return ctx

    return guard


async def require_verified_owner(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    authorize_verified_owner(ctx)
    return ctx
