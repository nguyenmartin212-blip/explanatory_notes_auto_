"""JWT access / refresh tokens (HS256, PyJWT).

- access token:  30 minutes, signed with JWT_SECRET
- refresh token: 7 days,     signed with REFRESH_TOKEN_SECRET (a different key)

A token carries only the user id, its type and the user's `token_version`.
Role and permissions are read from MongoDB on every request, so changes to a
role or an account apply immediately. Bumping `token_version` (e.g. password
change) invalidates every token issued before.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import jwt

from app.auth.constants import (
    ACCESS_TOKEN_MINUTES,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_LEEWAY_SECONDS,
    REFRESH_TOKEN_DAYS,
)
from app.core.errors import AuthenticationError, StartupError

if TYPE_CHECKING:
    from app.core.config import Settings

logger = logging.getLogger(__name__)

ACCESS = "access"
REFRESH = "refresh"
LIFETIMES = {
    ACCESS: timedelta(minutes=ACCESS_TOKEN_MINUTES),
    REFRESH: timedelta(days=REFRESH_TOKEN_DAYS),
}
_REQUIRED_CLAIMS = ["exp", "iat", "sub", "jti", "typ", "ver"]
_dev_secrets: dict[str, str] = {}


@dataclass(frozen=True)
class IssuedToken:
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str
    access_expires_at: datetime
    refresh_expires_at: datetime


@dataclass(frozen=True)
class TokenClaims:
    user_id: str
    token_type: str
    token_version: int
    jti: str
    issued_at: datetime
    expires_at: datetime


def _signing_secret(settings: Settings, token_type: str) -> str:
    value = settings.jwt_secret if token_type == ACCESS else settings.refresh_token_secret
    if value:
        return value
    if getattr(settings, "is_development", False):
        # Development convenience only: a random per-process secret (tokens die on restart).
        if token_type not in _dev_secrets:
            logger.warning("No %s secret configured: using a random development secret", token_type)
            _dev_secrets[token_type] = secrets.token_urlsafe(48)
        return _dev_secrets[token_type]
    raise StartupError(f"Signing secret for {token_type} tokens is not configured")


def create_token(
    settings: Settings,
    *,
    user_id: str,
    token_version: int,
    token_type: str,
    now: datetime | None = None,
) -> IssuedToken:
    now = now or datetime.now(timezone.utc)
    expires_at = now + LIFETIMES[token_type]
    payload = {
        "iss": JWT_ISSUER,
        "sub": user_id,
        "typ": token_type,
        "ver": token_version,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, _signing_secret(settings, token_type), algorithm=JWT_ALGORITHM)
    return IssuedToken(token=token, expires_at=expires_at)


def create_session_tokens(
    settings: Settings, *, user_id: str, token_version: int, now: datetime | None = None
) -> SessionTokens:
    now = now or datetime.now(timezone.utc)
    access = create_token(settings, user_id=user_id, token_version=token_version, token_type=ACCESS, now=now)
    refresh = create_token(settings, user_id=user_id, token_version=token_version, token_type=REFRESH, now=now)
    return SessionTokens(access.token, refresh.token, access.expires_at, refresh.expires_at)


def decode_token(settings: Settings, token: str | None, token_type: str) -> TokenClaims:
    """Verify signature, expiry, issuer and type. Raises AuthenticationError."""
    if not token or not isinstance(token, str):
        raise AuthenticationError("not_authenticated")
    try:
        payload = jwt.decode(
            token,
            _signing_secret(settings, token_type),
            algorithms=[JWT_ALGORITHM],  # never trust the token's own "alg"
            issuer=JWT_ISSUER,
            leeway=JWT_LEEWAY_SECONDS,
            options={"require": _REQUIRED_CLAIMS},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise AuthenticationError("invalid_token") from exc

    if payload["typ"] != token_type:
        raise AuthenticationError("invalid_token")
    if not isinstance(payload["sub"], str) or not isinstance(payload["ver"], int) or isinstance(payload["ver"], bool):
        raise AuthenticationError("invalid_token")
    return TokenClaims(
        user_id=payload["sub"],
        token_type=token_type,
        token_version=payload["ver"],
        jti=str(payload["jti"]),
        issued_at=datetime.fromtimestamp(payload["iat"], timezone.utc),
        expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc),
    )
