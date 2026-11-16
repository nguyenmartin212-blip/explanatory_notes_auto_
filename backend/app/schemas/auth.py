from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminOut(BaseModel):
    """Thông tin admin trả ra ngoài. KHÔNG có password_hash."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    is_active: bool
    created_at: datetime


class AdminCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=72)
    role: Literal["admin", "super_admin"] = "admin"


class AdminUpdate(BaseModel):
    """Super Admin đổi vai trò hoặc khóa/mở khóa tài khoản. Gửi trường nào sửa trường đó."""
    role: Optional[Literal["admin", "super_admin"]] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    """Super Admin đặt lại mật khẩu cho người khác."""
    new_password: str = Field(min_length=8, max_length=72)


class PasswordChange(BaseModel):
    """Admin tự đổi mật khẩu của mình."""
    old_password: str
    new_password: str = Field(min_length=8, max_length=72)
