"""Request models for authentication."""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    """Optional body for Bearer clients; browsers send the refresh cookie instead."""

    refresh_token: str | None = None
