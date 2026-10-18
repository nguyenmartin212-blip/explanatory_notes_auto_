"""httpOnly auth cookies. `response` is any object with set_cookie / delete_cookie
(a Starlette/FastAPI Response)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.auth.constants import (
    ACCESS_COOKIE_NAME,
    ACCESS_TOKEN_MINUTES,
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_PATH,
    REFRESH_TOKEN_DAYS,
)
from app.auth.tokens import SessionTokens

if TYPE_CHECKING:
    from app.core.config import Settings

SAMESITE_VALUES = ("lax", "strict", "none")


def cookie_secure(settings: Settings) -> bool:
    explicit = getattr(settings, "auth_cookie_secure", None)
    return bool(explicit) if explicit is not None else not getattr(settings, "is_development", False)


def _attrs(settings: Settings) -> dict:
    samesite = str(getattr(settings, "auth_cookie_samesite", "lax")).lower()
    if samesite not in SAMESITE_VALUES:
        samesite = "lax"
    secure = cookie_secure(settings) or samesite == "none"  # browsers reject SameSite=None without Secure
    return {
        "httponly": True,  # not readable from JavaScript
        "secure": secure,
        "samesite": samesite,
        "domain": getattr(settings, "auth_cookie_domain", None) or None,
    }


def set_auth_cookies(response, settings: Settings, session: SessionTokens) -> None:
    attrs = _attrs(settings)
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        session.access_token,
        max_age=ACCESS_TOKEN_MINUTES * 60,
        path="/",
        **attrs,
    )
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        session.refresh_token,
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600,
        path=REFRESH_COOKIE_PATH,
        **attrs,
    )


def clear_auth_cookies(response, settings: Settings) -> None:
    attrs = _attrs(settings)
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/", **attrs)
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH, **attrs)
