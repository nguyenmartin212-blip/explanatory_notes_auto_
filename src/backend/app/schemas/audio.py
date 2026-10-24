"""Request models for the audio module."""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.content import SUPPORTED_LANGUAGES

MAX_TTS_TEXT_CHARS = 5000


class TtsRequest(BaseModel):
    """POST /audio/tts body.

    `text` is spoken in `lang`. If `source_lang` is given and differs from
    `lang`, the text is first translated from `source_lang` to `lang`.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=MAX_TTS_TEXT_CHARS)
    lang: str
    source_lang: str | None = None

    @field_validator("lang", "source_lang")
    @classmethod
    def _supported(cls, value):
        if value is not None and value not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language '{value}'; supported: {list(SUPPORTED_LANGUAGES)}")
        return value
