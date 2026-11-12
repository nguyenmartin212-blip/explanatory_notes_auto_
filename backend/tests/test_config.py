"""Unit tests that do not require MongoDB or Redis services."""

from app.core.config import Settings
from app.schemas.content import PoiCreate


def test_development_cors_is_credential_compatible():
    settings = Settings(_env_file=None, app_env="development", cors_allow_origins="")
    assert settings.cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_production_requires_explicit_cors_origins():
    settings = Settings(_env_file=None, app_env="production", cors_allow_origins="")
    assert settings.cors_origins == []


def test_poi_schema_rejects_invalid_latitude():
    from pydantic import ValidationError

    try:
        PoiCreate(poi_id="demo-invalid", latitude=99, longitude=106)
    except ValidationError:
        return
    assert False, "Expected a validation error for out-of-range latitude"
