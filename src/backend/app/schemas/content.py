"""Request models for the content module (POI lifecycle)."""

from pydantic import BaseModel, ConfigDict, Field, field_validator

SUPPORTED_LANGUAGES = ("vi", "en", "zh", "ja", "ko")
# Same rule as the FE (cleanId in src/features/qr/services/qr-content.ts: /^[a-z0-9][a-z0-9-]{1,80}$/i)
POI_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9-]{1,80}$"
# Same value as the FE (DEFAULT_GEOFENCE_RADIUS_METERS in src/constants/app.ts)
DEFAULT_RADIUS_METERS = 80


class LocalizationIn(BaseModel):
    """Content of one language. Writing a language replaces that language's content."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    tts_script: str | None = Field(default=None, max_length=5000)


def _check_languages(value):
    if value is None:
        return value
    bad = sorted(key for key in value if key not in SUPPORTED_LANGUAGES)
    if bad:
        raise ValueError(f"Unsupported language(s) {bad}; supported: {list(SUPPORTED_LANGUAGES)}")
    return value


class PoiCreate(BaseModel):
    poi_id: str | None = Field(default=None, pattern=POI_ID_PATTERN)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_meters: int = Field(default=DEFAULT_RADIUS_METERS, ge=1, le=5000)
    priority: int = Field(default=0, ge=0, le=1000)
    images: list[str] = Field(default_factory=list, max_length=50)
    map_url: str | None = Field(default=None, max_length=2000)
    localizations: dict[str, LocalizationIn] = Field(default_factory=dict)

    _languages = field_validator("localizations")(_check_languages)


class PoiUpdate(BaseModel):
    """Partial update: only fields that are sent are changed."""

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_meters: int | None = Field(default=None, ge=1, le=5000)
    priority: int | None = Field(default=None, ge=0, le=1000)
    images: list[str] | None = Field(default=None, max_length=50)
    map_url: str | None = Field(default=None, max_length=2000)
    localizations: dict[str, LocalizationIn] | None = None

    _languages = field_validator("localizations")(_check_languages)
