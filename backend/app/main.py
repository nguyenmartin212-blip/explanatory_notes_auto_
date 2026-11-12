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
    origins = get_settings().cors_origins
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials="*" not in origins,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["ETag", "Retry-After"],
        )
    return app


app = create_app()
