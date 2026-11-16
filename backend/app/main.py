"""Điểm khởi động của backend. Chạy: uvicorn app.main:app --reload"""

import asyncio

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app import database
from app.config import settings
from app.core.exceptions import AppError
from app.database import engine
from app.routers import admin_pois, admin_stats, analytics, auth, offline, public_pois, web_auth, web_devices, web_visits
from app.services.audio_recovery import recover_audio_tasks
from app.services.audio_worker import run_audio_worker

STATIC_DIR = Path(__file__).resolve().parent / "static"
(STATIC_DIR / "audio").mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "images").mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.TABLES = await run_in_threadpool(database.check_schema, engine)
    stop = asyncio.Event()
    worker = None
    if "audio_tasks" in database.TABLES:
        await recover_audio_tasks()
        worker = asyncio.create_task(run_audio_worker(stop))
    try:
        yield
    finally:
        stop.set()
        if worker is not None:
            await worker
        database.TABLES = None


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
app.include_router(web_auth.router)
app.include_router(web_visits.router)
app.include_router(web_devices.router)


@app.get("/health", tags=["Hệ thống"])
def health():
    """Kiểm tra server còn sống."""
    return {"status": "ok"}


@app.get("/health/ready", tags=["Hệ thống"])
def ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    return {"status": "ready"}
