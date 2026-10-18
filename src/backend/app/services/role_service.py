"""Dynamic roles (stored in MongoDB) and role assignment.

Anti-escalation rules: nobody can grant a permission they do not hold themselves,
the wildcard role (`super_admin`) is immutable and can only be handed out by a
wildcard holder, and the last super admin cannot be demoted.
"""

from __future__ import annotations

import re

from app.auth.context import AuthContext
from app.auth.permissions import (
    DEFAULT_ROLES,
    SUPER_ADMIN_ROLE,
    WILDCARD,
    validate_permissions,
)
from app.core.errors import ConflictError, NotFoundError, PermissionDenied
from app.stores import admin_user_store, role_store

ROLE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
DEFAULT_ROLE_NAMES = frozenset(r["name"] for r in DEFAULT_ROLES)


def _require(ctx: AuthContext, permission: str) -> None:
    if not ctx.has_permission(permission):
        raise PermissionDenied("forbidden", f"Missing permission(s): {permission}", (permission,))


def _is_wildcard_holder(ctx: AuthContext) -> bool:
    return WILDCARD in ctx.permissions


def _ensure_can_grant(ctx: AuthContext, permissions: list[str]) -> None:
    """The actor may only hand out permissions they hold themselves."""
    if _is_wildcard_holder(ctx):
        return
    if WILDCARD in permissions:
        raise PermissionDenied("forbidden", "Only a super admin can grant the wildcard permission")
    missing = tuple(sorted(set(permissions) - ctx.permissions))
    if missing:
        raise PermissionDenied(
            "forbidden", f"Cannot grant permissions you do not hold: {', '.join(missing)}", missing
        )


async def list_roles(db, ctx: AuthContext) -> list[dict]:
    _require(ctx, "role:read")
    return await role_store.list_all(db)


async def create_role(
    db, ctx: AuthContext, *, name: str, permissions: list[str], description: str = ""
) -> dict:
    _require(ctx, "role:create")
    name = (name or "").strip().lower()
    if not ROLE_NAME_RE.match(name):
        raise ValueError("Role name must be 2-40 chars: lower-case letters, digits, underscore; start with a letter")
    perms = validate_permissions(permissions)  # unknown names and "*" are rejected
    _ensure_can_grant(ctx, perms)
    doc = {"name": name, "description": description.strip(), "permissions": perms, "is_default": False}
    await role_store.create(db, doc)
    return await role_store.get(db, name)


async def update_role(
    db, ctx: AuthContext, name: str, *, permissions: list[str] | None = None, description: str | None = None
) -> dict:
    _require(ctx, "role:update")
    role = await role_store.get(db, name)
    if role is None:
        raise NotFoundError(f"Role '{name}' not found")
    if name == SUPER_ADMIN_ROLE:
        raise ConflictError("The super_admin role cannot be modified")

    fields: dict = {}
    if permissions is not None:
        perms = validate_permissions(permissions)
        _ensure_can_grant(ctx, perms)
        # Also cannot edit a role that is stronger than yourself (that would be a way to lower it).
        _ensure_can_grant(ctx, list(role.get("permissions", [])))
        fields["permissions"] = perms
    if description is not None:
        fields["description"] = description.strip()
    if fields:
        await role_store.update(db, name, fields)
    return await role_store.get(db, name)


async def delete_role(db, ctx: AuthContext, name: str) -> None:
    _require(ctx, "role:delete")
    role = await role_store.get(db, name)
    if role is None:
        raise NotFoundError(f"Role '{name}' not found")
    if name in DEFAULT_ROLE_NAMES or role.get("is_default"):
        raise ConflictError("Default roles cannot be deleted")
    in_use = await admin_user_store.count_with_role(db, name)
    if in_use:
        raise ConflictError(f"Role '{name}' is assigned to {in_use} user(s); reassign them first")
    await role_store.delete(db, name)


async def assign_role(db, ctx: AuthContext, target_user_id: str, role_name: str) -> dict:
    _require(ctx, "user:update")
    role = await role_store.get(db, role_name)
    if role is None:
        raise NotFoundError(f"Role '{role_name}' not found")
    target = await admin_user_store.get_by_id(db, target_user_id)
    if target is None:
        raise NotFoundError(f"User '{target_user_id}' not found")

    _ensure_can_grant(ctx, list(role.get("permissions", [])))

    current = await role_store.get(db, target.get("role"))
    if current is not None:
        # Changing someone who is stronger than you is also escalation-relevant.
        _ensure_can_grant(ctx, list(current.get("permissions", [])))
    if target.get("role") == SUPER_ADMIN_ROLE and role_name != SUPER_ADMIN_ROLE:
        if await admin_user_store.count_with_role(db, SUPER_ADMIN_ROLE) <= 1:
            raise ConflictError("The last super admin cannot be demoted")

    await admin_user_store.set_role(db, target_user_id, role_name)
    return await admin_user_store.get_by_id(db, target_user_id)
