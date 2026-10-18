from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"

    # Secrets (validated by the security guard outside development)
    jwt_secret: str = ""
    refresh_token_secret: str = ""
    secret_key: str = ""

    # disabled | env
    superadmin_bootstrap_mode: str = "disabled"
    superadmin_username: str = ""
    superadmin_password: str = ""

    mongo_uri: str = "mongodb://localhost:27017/?replicaSet=rs0"
    mongo_db: str = "explanatory_notes"
    mongo_server_selection_timeout_ms: int = 5000
    redis_url: str = "redis://localhost:6379/0"

    # local | none
    media_storage_backend: str = "local"
    media_dir: Path = Path("./runtime/media")
    runtime_dir: Path = Path("./runtime")
    static_dir: Path = Path("./runtime/static")

    audio_task_stale_seconds: int = 900
    maintenance_interval_seconds: int = 60

    # Authentication & RBAC (Chapter 07)
    # One or more Fernet keys, comma separated: the first encrypts, all decrypt (key rotation).
    cccd_encryption_keys: str = ""
    cccd_retention_check_seconds: int = 3600
    auth_cookie_secure: bool | None = None  # None: Secure outside development
    auth_cookie_samesite: str = "lax"  # lax | strict | none
    auth_cookie_domain: str | None = None

    # Audio / TTS (Chapter 06)
    tts_cache_dir: Path = Path("./runtime/tts-cache")
    tts_timeout_seconds: int = 60
    tts_max_text_chars: int = 5000
    audio_max_concurrency: int = 3
    audio_poll_interval_seconds: float = 2.0
    audio_sse_poll_seconds: float = 1.0
    media_public_prefix: str = "/media"
    # Public base URL used to build the absolute audio URLs sent to the app (empty: taken from the request)
    public_base_url: str = ""

    # Browser clients (Expo web runs on another origin). Comma separated origins, "*" = any.
    # Empty: any origin in development, none otherwise. Credentials (cookies) are only
    # allowed for explicitly listed origins.
    cors_allow_origins: str = ""

    # Localization & UI bundles (Chapter 08)
    localization_hotset_radius_m: int = 1500
    localization_hotset_max_pois: int = 10
    localization_hotset_required: int = 3
    localization_translate_concurrency: int = 3
    localization_queue_max: int = 1000
    localization_on_demand_wait_seconds: float = 5.0
    localization_failure_cooldown_seconds: int = 60
    localization_rate_limit_requests: int = 30  # per client, per window
    localization_rate_limit_window_seconds: int = 60
    localization_warmup_cooldown_seconds: int = 300
    ui_bundle_lock_seconds: int = 600
    ui_bundle_failure_cooldown_seconds: int = 300

    @property
    def cors_origins(self) -> list[str]:
        value = self.cors_allow_origins.strip() or ("*" if self.is_development else "")
        return [o.strip() for o in value.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.app_env.strip().lower() in {"development", "dev", "local"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
