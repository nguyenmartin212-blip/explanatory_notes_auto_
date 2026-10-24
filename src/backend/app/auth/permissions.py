"""RBAC catalog and the 4 default roles.

Permission names are `<domain>:<action>`. Roles are stored in MongoDB (`roles`)
and can be edited at runtime; this module only defines what exists and what the
default roles start with. The only wildcard is "*", reserved for `super_admin`.
"""

from __future__ import annotations

from collections.abc import Iterable

WILDCARD = "*"

SUPER_ADMIN_ROLE = "super_admin"
ADMIN_ROLE = "admin"
POI_OWNER_ROLE = "poi_owner"
USER_ROLE = "user"

# domain -> {permission: description}
PERMISSION_CATALOG: dict[str, dict[str, str]] = {
    "poi": {
        "poi:read": "View public POIs",
        "poi:read_draft": "View POIs that are not activated yet",
        "poi:create": "Create POIs",
        "poi:update": "Update POIs and their localizations",
        "poi:delete": "Delete POIs",
        "poi:activate": "Activate (publish) POIs",
    },
    "audio": {
        "audio:read": "View audio and audio packs",
        "audio:generate": "Request audio generation",
        "audio:manage": "Manage audio tasks (progress stream, pause, cancel, retry)",
        "audio:delete": "Delete audio files",
    },
    "localization": {
        "localization:read": "View localizations",
        "localization:update": "Edit localizations",
        "localization:translate": "Run automatic translation",
    },
    "user": {
        "user:read": "View user accounts",
        "user:create": "Create user accounts",
        "user:update": "Update user accounts",
        "user:delete": "Delete user accounts",
    },
    "role": {
        "role:read": "View roles",
        "role:create": "Create roles",
        "role:update": "Change role permissions",
        "role:delete": "Delete roles",
    },
    "owner": {
        "owner:read": "View POI owner accounts",
        "owner:profile": "Manage one's own owner profile and CCCD",
        "owner:verify": "Verify or un-verify POI owners",
        "owner:view_cccd": "View a decrypted owner CCCD (audited)",
    },
    "analytics": {
        "analytics:read": "View analytics",
        "analytics:export": "Export analytics",
    },
    "visitor": {
        "visitor:read": "View anonymous QR visitor records",
    },
    "ai": {
        "ai:use": "Use the AI advisor",
        "ai:manage_limits": "Manage AI usage limits",
    },
    "system": {
        "system:audit_read": "Read audit logs",
        "system:runtime_read": "Read runtime observability data",
        "system:i18n_manage": "Manage UI translations",
    },
}

PERMISSIONS: dict[str, str] = {p: d for group in PERMISSION_CATALOG.values() for p, d in group.items()}
ALL_PERMISSIONS: frozenset[str] = frozenset(PERMISSIONS)
DOMAINS: tuple[str, ...] = tuple(PERMISSION_CATALOG)

# A poi_owner who is not verified may only use these (so they can submit their CCCD).
OWNER_UNVERIFIED_ALLOWED: frozenset[str] = frozenset({"owner:profile"})

_ADMIN_EXCLUDED = {"role:create", "role:update", "role:delete", "user:delete"}

DEFAULT_ROLES: list[dict] = [
    {
        "name": SUPER_ADMIN_ROLE,
        "description": "Full access to everything",
        "permissions": [WILDCARD],
        "is_default": True,
    },
    {
        "name": ADMIN_ROLE,
        "description": "Operates the system; cannot manage roles or delete users",
        "permissions": sorted(ALL_PERMISSIONS - _ADMIN_EXCLUDED),
        "is_default": True,
    },
    {
        "name": POI_OWNER_ROLE,
        "description": "Shop owner; every action also requires is_poi_owner_verified",
        "permissions": [
            "poi:read",
            "poi:read_draft",
            "poi:create",
            "poi:update",
            "audio:read",
            "audio:generate",
            "localization:read",
            "localization:update",
            "analytics:read",
            "owner:profile",
            "ai:use",
        ],
        "is_default": True,
    },
    {
        "name": USER_ROLE,
        "description": "Regular user",
        "permissions": ["poi:read", "audio:read", "localization:read", "ai:use"],
        "is_default": True,
    },
]


def validate_permissions(permissions: Iterable[str], *, allow_wildcard: bool = False) -> list[str]:
    """Return the permissions de-duplicated and sorted; raise ValueError if any is unknown."""
    seen = set(permissions)
    unknown = sorted(p for p in seen if p not in ALL_PERMISSIONS and not (allow_wildcard and p == WILDCARD))
    if unknown:
        raise ValueError(f"Unknown permission(s): {unknown}")
    return sorted(seen)
