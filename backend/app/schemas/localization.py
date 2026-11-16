from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class LocalizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lang_code: str
    name: str
    description: str
    audio_url: Optional[str] = None
    audio_status: str
    is_machine_translated: bool


class LocalizationUpdate(BaseModel):
    """Admin sửa tay bản dịch."""
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=10)
