"""Đọc cấu hình từ file .env (đặt cạnh thư mục app/)."""

import os
from dotenv import load_dotenv

load_dotenv()  # nạp biến trong .env vào môi trường


class Settings:
    # --- Kết nối MySQL ---
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_NAME = os.getenv("DB_NAME", "audio_guide")
    DATABASE_URL = os.getenv("DATABASE_URL", "")

    # --- Đăng nhập admin ---
    SECRET_KEY = os.getenv("SECRET_KEY", "doi-chuoi-nay-trong-file-env")
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

    # --- Cho phép frontend gọi API ---
    CORS_ORIGINS = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]


settings = Settings()
