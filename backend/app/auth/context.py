"""Who is calling and what they may do. Pure logic: no web framework, no database."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from app.auth.permissions import OWNER_UNVERIFIED_ALLOWED, POI_OWNER_ROLE, WILDCARD
from app.core.errors import PermissionDenied


@dataclass(frozen=True)
class AuthContext:
    user: dict
    role: dict | None  # None if the user's role no longer exists
    permissions: frozenset[str]

    @property
    def user_id(self) -> str:
        return self.user["user_id"]

    @property
    def role_name(self) -> str | None:
        return self.user.get("role")

    @property
    def is_poi_owner_verified(self) -> bool:
        return bool(self.user.get("is_poi_owner_verified"))

    def has_permission(self, permission: str) -> bool:
        return WILDCARD in self.permissions or permission in self.permissions


def build_context(user: dict, role: dict | None) -> AuthContext:
    return AuthContext(user=user, role=role, permissions=frozenset((role or {}).get("permissions", [])))


def extract_token(authorization: str | None, cookie_value: str | None) -> str | None:
    """Bearer header first (API clients), then the httpOnly cookie (browsers)."""
    if authorization:
        scheme, _, value = authorization.strip().partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    return cookie_value or None


def authorize(ctx: AuthContext, required: Iterable[str]) -> None:
    """Allow only if the role has every required permission.

    A `poi_owner` must ALSO be verified (`is_poi_owner_verified`): having the role
    is not enough. Unverified owners may only use OWNER_UNVERIFIED_ALLOWED.
    """
    required = tuple(required)
    if ctx.role is None:
        raise PermissionDenied("forbidden", "The account's role no longer exists")

    if (
        ctx.role_name == POI_OWNER_ROLE
        and not ctx.is_poi_owner_verified
        and not set(required) <= OWNER_UNVERIFIED_ALLOWED
    ):
        raise PermissionDenied("owner_not_verified", "POI owner is not verified yet")

    missing = tuple(p for p in required if not ctx.has_permission(p))
    if missing:
        raise PermissionDenied("forbidden", f"Missing permission(s): {', '.join(missing)}", missing)


def authorize_verified_owner(ctx: AuthContext) -> None:
    """For owner-only endpoints: the caller must be a poi_owner AND verified."""
    if ctx.role_name != POI_OWNER_ROLE:
        raise PermissionDenied("not_an_owner", "This endpoint is for POI owners")
    if not ctx.is_poi_owner_verified:
        raise PermissionDenied("owner_not_verified", "POI owner is not verified yet")
