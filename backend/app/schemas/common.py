from pydantic import BaseModel


class MessageResponse(BaseModel):
    """Phản hồi đơn giản: chỉ có một câu thông báo."""
    detail: str
