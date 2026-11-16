"""Đọc cấu hình từ file .env (đặt cạnh thư mục app/)."""

import os
from pathlib import Path
from secrets import token_urlsafe
from tempfile import gettempdir

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings:
    IS_VERCEL = os.getenv("VERCEL") == "1"
    STATIC_DIR = (
        Path(gettempdir()) / "go-to-horizon-static"
        if IS_VERCEL else Path(__file__).resolve().parent / "static"
    )

    # --- Kết nối MySQL ---
    DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_NAME = os.getenv("DB_NAME", "Thuyet_minh_da_ngon_ngu")
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    DATABASE_CONFIGURED = bool(
        not IS_VERCEL
        or DATABASE_URL
        or DB_HOST.strip().lower() not in {"", "127.0.0.1", "localhost", "::1"}
    )

    # --- Đăng nhập admin ---
    SECRET_KEY = os.getenv("SECRET_KEY") or token_urlsafe(48)
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

    # --- Cho phép frontend gọi API ---
    CORS_ORIGINS = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if o.strip()
    ]


settings = Settings()
