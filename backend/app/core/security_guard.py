"""Step 1 — Security & Bootstrap Guard.

Runs before any connection is opened. Outside development, weak or missing
secrets and unsafe super-admin bootstrap settings abort the startup.
"""

from app.core.config import Settings
from app.core.errors import StartupError

SECRET_ENV_NAMES = {
    "JWT_SECRET": "jwt_secret",
    "REFRESH_TOKEN_SECRET": "refresh_token_secret",
    "SECRET_KEY": "secret_key",
}
MIN_SECRET_LENGTH = 32
MIN_ADMIN_PASSWORD_LENGTH = 12
PLACEHOLDER_MARKERS = ("changeme", "change-me", "change_me", "secret", "example", "default", "password")
BOOTSTRAP_MODES = {"disabled", "env"}


def _secret_problems(settings: Settings) -> list[str]:
    problems: list[str] = []
    values: dict[str, str] = {}
    for env_name, attr in SECRET_ENV_NAMES.items():
        value = getattr(settings, attr)
        values[env_name] = value
        if not value:
            problems.append(f"{env_name} is not set")
        elif len(value) < MIN_SECRET_LENGTH:
            problems.append(f"{env_name} must be at least {MIN_SECRET_LENGTH} characters")
        elif any(marker in value.lower() for marker in PLACEHOLDER_MARKERS):
            problems.append(f"{env_name} looks like a placeholder value")

    non_empty = [v for v in values.values() if v]
    if len(set(non_empty)) != len(non_empty):
        problems.append("JWT_SECRET, REFRESH_TOKEN_SECRET and SECRET_KEY must all be different")
    return problems


def _bootstrap_problems(settings: Settings) -> list[str]:
    problems: list[str] = []
    mode = settings.superadmin_bootstrap_mode.strip().lower()
    if mode not in BOOTSTRAP_MODES:
        problems.append(
            f"SUPERADMIN_BOOTSTRAP_MODE must be one of {sorted(BOOTSTRAP_MODES)}, got '{mode}'"
        )
        return problems

    if mode == "env":
        if not settings.superadmin_username.strip():
            problems.append("SUPERADMIN_USERNAME is required when SUPERADMIN_BOOTSTRAP_MODE=env")
        if not settings.superadmin_password:
            problems.append("SUPERADMIN_PASSWORD is required when SUPERADMIN_BOOTSTRAP_MODE=env")
        elif (
            not settings.is_development
            and len(settings.superadmin_password) < MIN_ADMIN_PASSWORD_LENGTH
        ):
            problems.append(
                f"SUPERADMIN_PASSWORD must be at least {MIN_ADMIN_PASSWORD_LENGTH} characters"
            )
    return problems


def _cccd_key_problems(settings: Settings) -> list[str]:
    """Owner CCCD is encrypted with Fernet: outside development a valid key is mandatory."""
    from app.auth.cccd import parse_keys, validate_fernet_keys

    keys = parse_keys(getattr(settings, "cccd_encryption_keys", ""))
    problems: list[str] = []
    if not keys and not settings.is_development:
        problems.append("CCCD_ENCRYPTION_KEYS is not set")
    problems.extend(validate_fernet_keys(keys))
    return problems


def validate_security_config(settings: Settings) -> None:
    problems = _bootstrap_problems(settings) + _cccd_key_problems(settings)
    if not settings.is_development:
        problems = _secret_problems(settings) + problems
    if problems:
        raise StartupError(
            "Security guard failed:\n" + "\n".join(f"  - {p}" for p in problems)
        )
