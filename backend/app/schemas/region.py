from pydantic import BaseModel, ConfigDict


class RegionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # cho phép đọc từ đối tượng SQLAlchemy

    id: int
    code: str
    name_vi: str
