"""Điểm khởi động của backend. Chạy: uvicorn app.main:app --reload"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import app.models  # noqa: F401  (nạp các model để SQLAlchemy biết các bảng)
from app.config import settings
from app.core.exceptions import AppError
from app.database import Base, engine
from app.routers import admin_pois, admin_stats, analytics, auth, offline, public_pois

STATIC_DIR = Path(__file__).resolve().parent / "static"
(STATIC_DIR / "audio").mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "images").mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tạo các bảng còn thiếu (nếu đã chạy schema.sql thì bước này không làm gì)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="API Thuyết minh đa ngôn ngữ các khu vực nổi tiếng 3 miền",
    version="1.0.0",
    lifespan=lifespan,
)

# Cho phép frontend (khác cổng) gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# File audio / ảnh: truy cập qua /static/audio/xxx.mp3
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(public_pois.router)
app.include_router(offline.router)
app.include_router(analytics.router)
app.include_router(auth.router)
app.include_router(admin_pois.router)
app.include_router(admin_stats.router)


@app.get("/health", tags=["Hệ thống"])
def health():
    """Kiểm tra server còn sống."""
    return {"status": "ok"}
