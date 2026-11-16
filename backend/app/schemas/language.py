from pydantic import BaseModel, ConfigDict


class LanguageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
