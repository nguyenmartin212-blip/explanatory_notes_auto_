from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Liveness: the process is up."""
    return {"status": "ok"}


@router.get("/health/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness: startup finished and Mongo, Redis and workers are healthy."""
    state = request.app.state
    checks: dict[str, bool] = {"startup": bool(getattr(state, "ready", False))}

    if checks["startup"]:
        try:
            await state.mongo_client.admin.command("ping")
            checks["mongodb"] = True
        except Exception:
            checks["mongodb"] = False
        try:
            await state.redis.ping()
            checks["redis"] = True
        except Exception:
            checks["redis"] = False
        checks["workers"] = state.workers.is_healthy()

    is_ready = all(checks.values())
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "not_ready", "checks": checks},
    )
