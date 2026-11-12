"""Request models for the localization lane."""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.content import SUPPORTED_LANGUAGES


def _supported(value):
    if value is not None and value not in SUPPORTED_LANGUAGES:
        raise ValueError(f"Unsupported language '{value}'; supported: {list(SUPPORTED_LANGUAGES)}")
    return value


class HotsetRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    lang: str

    _lang = field_validator("lang")(_supported)


class OnDemandRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    poi_id: str = Field(min_length=1, max_length=100)
    lang: str

    _lang = field_validator("lang")(_supported)


class WarmupRequest(BaseModel):
    """`lang` omitted: warm every supported language."""

    lang: str | None = None

    _lang = field_validator("lang")(_supported)
