"""Login, token refresh/rotation, logout and request authentication.

- Passwords are verified with bcrypt (see app.auth.passwords). An unknown username
  costs the same time as a wrong password and gives the same error.
- A token is valid only if: signature/expiry/type are valid, its jti is not on the
  revocation list (Redis), the user still exists and is active, and the token's
  `ver` equals the user's `token_version`.
- Refresh tokens are single use (rotation): using one revokes it atomically.
- If the revocation list (Redis) cannot be reached the request is refused
  (fail closed, HTTP 503): a logged-out token must never be accepted by accident.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.auth.constants import ACCESS_TOKEN_MINUTES, JWT_LEEWAY_SECONDS, REFRESH_TOKEN_DAYS
from app.auth.context import AuthContext, build_context
from app.auth.cccd import mask_cccd  # noqa: F401  (re-exported for views)
from app.auth.passwords import default_hasher
from app.auth.permissions import OWNER_UNVERIFIED_ALLOWED, POI_OWNER_ROLE, WILDCARD
from app.auth.tokens import ACCESS, REFRESH, SessionTokens, TokenClaims, create_session_tokens, decode_token
from app.core.errors import AuthenticationError
from app.stores import admin_user_store, role_store

logger = logging.getLogger(__name__)

REVOKED_PREFIX = "auth:revoked:"


# --------------------------------------------------------------------------- #
# Revocation list (Redis)
# --------------------------------------------------------------------------- #
def _ttl_seconds(claims: TokenClaims, now: datetime) -> int:
    return max(int((claims.expires_at - now).total_seconds()), 0) + JWT_LEEWAY_SECONDS + 1


async def _is_revoked(redis, jti: str) -> bool:
    try:
        return bool(await redis.exists(REVOKED_PREFIX + jti))
    except Exception as exc:
        logger.error("Cannot read the token revocation list: %s", exc)
        raise AuthenticationError("auth_unavailable", "Authentication is temporarily unavailable") from exc


async def _revoke(redis, claims: TokenClaims, now: datetime) -> bool:
    """Put the token on the revocation list. Returns False if it already was
    (atomic SET NX), so concurrent uses of one refresh token cannot both win."""
    try:
        done = await redis.set(REVOKED_PREFIX + claims.jti, "1", ex=_ttl_seconds(claims, now), nx=True)
    except Exception as exc:
        logger.error("Cannot write the token revocation list: %s", exc)
        raise AuthenticationError("auth_unavailable", "Authentication is temporarily unavailable") from exc
    return bool(done)


# --------------------------------------------------------------------------- #
# Checks shared by every flow
# --------------------------------------------------------------------------- #
def _check_user(user: dict | None, claims: TokenClaims) -> dict:
    if user is None or claims.token_version != user.get("token_version", 0):
        raise AuthenticationError("invalid_token")
    if not user.get("is_active", False):
        raise AuthenticationError("account_disabled")
    return user


# --------------------------------------------------------------------------- #
# Flows
# --------------------------------------------------------------------------- #
async def login(
    db, settings, username: str, password: str, *, hasher=default_hasher, now: datetime | None = None
) -> tuple[dict, SessionTokens]:
    now = now or datetime.now(timezone.utc)
    username = (username or "").strip().lower()
    user = await admin_user_store.get_by_username(db, username) if username else None

    if user is None:
        await hasher.dummy_verify(password or "")
        raise AuthenticationError("invalid_credentials", "Wrong username or password")
    if not await hasher.verify(password or "", user.get("password_hash")):
        raise AuthenticationError("invalid_credentials", "Wrong username or password")
    if not user.get("is_active", False):
        raise AuthenticationError("account_disabled", "This account is disabled")

    await admin_user_store.record_login(db, user["user_id"], now)
    session = create_session_tokens(
        settings, user_id=user["user_id"], token_version=user.get("token_version", 0), now=now
    )
    return user, session


async def refresh_session(
    db, redis, settings, refresh_token: str | None, *, now: datetime | None = None
) -> tuple[dict, SessionTokens]:
    """Exchange a refresh token for a new access + refresh pair (rotation)."""
    now = now or datetime.now(timezone.utc)
    claims = decode_token(settings, refresh_token, REFRESH)
    if await _is_revoked(redis, claims.jti):
        raise AuthenticationError("invalid_token")
    user = _check_user(await admin_user_store.get_by_id(db, claims.user_id), claims)

    if not await _revoke(redis, claims, now):  # lost a race with another use of the same token
        raise AuthenticationError("invalid_token")
    session = create_session_tokens(
        settings, user_id=user["user_id"], token_version=user.get("token_version", 0), now=now
    )
    return user, session


async def logout(
    redis,
    settings,
    *,
    access_token: str | None = None,
    refresh_token: str | None = None,
    now: datetime | None = None,
) -> int:
    """Revoke the given tokens. Invalid or expired tokens are ignored (nothing to revoke).
    Returns how many tokens were revoked."""
    now = now or datetime.now(timezone.utc)
    revoked = 0
    for token, token_type in ((access_token, ACCESS), (refresh_token, REFRESH)):
        if not token:
            continue
        try:
            claims = decode_token(settings, token, token_type)
        except AuthenticationError:
            continue
        if await _revoke(redis, claims, now):
            revoked += 1
    return revoked


async def revoke_all_sessions(db, user_id: str) -> bool:
    """Invalidate every token the user holds (e.g. password change, account takeover)."""
    return await admin_user_store.bump_token_version(db, user_id) is not None


async def authenticate(db, redis, settings, token: str | None) -> AuthContext:
    """Resolve an access token to a user + role. Raises AuthenticationError."""
    claims = decode_token(settings, token, ACCESS)
    if await _is_revoked(redis, claims.jti):
        raise AuthenticationError("invalid_token")
    user = _check_user(await admin_user_store.get_by_id(db, claims.user_id), claims)
    role = await role_store.get(db, user.get("role"))
    return build_context(user, role)


# --------------------------------------------------------------------------- #
# Views
# --------------------------------------------------------------------------- #
def effective_permissions(ctx: AuthContext) -> list[str]:
    """What the caller can really use. An unverified poi_owner is limited to
    OWNER_UNVERIFIED_ALLOWED regardless of the role's permission list."""
    if ctx.role is None:
        return []
    perms = set(ctx.permissions)
    if ctx.role_name == POI_OWNER_ROLE and not ctx.is_poi_owner_verified:
        perms = {p for p in perms if p in OWNER_UNVERIFIED_ALLOWED}
    return [WILDCARD] if WILDCARD in perms else sorted(perms)


def user_view(ctx: AuthContext) -> dict:
    """Safe public view of the caller: never includes the password hash or any CCCD data."""
    user = ctx.user
    return {
        "user_id": user["user_id"],
        "username": user["username"],
        "email": user.get("email"),
        "role": user.get("role"),
        "is_active": bool(user.get("is_active")),
        "is_poi_owner_verified": ctx.is_poi_owner_verified,
        "owner_status": user.get("owner_status", "none"),
        "permissions": effective_permissions(ctx),
    }


def token_response(session: SessionTokens) -> dict:
    """Body for Bearer-header clients (browsers use the httpOnly cookies set alongside)."""
    return {
        "token_type": "bearer",
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expires_in": ACCESS_TOKEN_MINUTES * 60,
        "refresh_expires_in": REFRESH_TOKEN_DAYS * 24 * 3600,
    }
