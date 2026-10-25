from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.error_handlers import register_error_handlers
from app.startup import run_shutdown, run_startup


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await run_startup(app, settings)
    try:
        yield
    finally:
        await run_shutdown(app)


def create_app() -> FastAPI:
    app = FastAPI(title="Explanatory Notes Auto API", lifespan=lifespan)
    register_error_handlers(app)
    settings = get_settings()
    origins = settings.cors_origins
    if origins:
        wildcard = "*" in origins
        # Đăng nhập admin dùng cookie httpOnly (fetch credentials: "include"). Trình duyệt từ chối
        # "Access-Control-Allow-Origin: *" khi có credentials, nên ở development ta phản chiếu lại
        # đúng Origin của request (regex) và bật allow_credentials. Ngoài development, "*" vẫn
        # KHÔNG được phép gửi cookie; phải liệt kê origin cụ thể trong CORS_ALLOW_ORIGINS.
        reflect_any_origin = wildcard and settings.is_development
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[] if reflect_any_origin else origins,
            allow_origin_regex=r".*" if reflect_any_origin else None,
            allow_credentials=reflect_any_origin or not wildcard,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["ETag", "Retry-After"],
        )
    return app


app = create_app()
