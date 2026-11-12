from fastapi import APIRouter, HTTPException, Request

from app.core.errors import NotFoundError, TtsError
from app.schemas.localization import HotsetRequest, OnDemandRequest, WarmupRequest
from app.services import localization_service
from app.core.config import get_settings

# Paths of Chapter 08: /localizations/prepare-hotset, /localizations/on-demand,
# /localizations/warmup (and /warmup).
router = APIRouter(tags=["localization"])


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _deps(request: Request):
    state = request.app.state
    return state.db, state.redis, get_settings(), state.localization


@router.post("/localizations/prepare-hotset")
async def prepare_hotset(request: Request, body: HotsetRequest):
    """Warm up to 10 POIs within 1.5 km. `ready` is true when the 3 required POIs
    have content and audio in `lang`. Call again to poll."""
    db, redis, settings, hydrator = _deps(request)
    return await localization_service.prepare_hotset(
        db, redis, settings, hydrator, lat=body.lat, lng=body.lng, lang=body.lang, client=_client(request)
    )


@router.post("/localizations/on-demand")
async def on_demand(request: Request, body: OnDemandRequest):
    """Reactive: hydrate one POI in `lang` now."""
    db, redis, settings, hydrator = _deps(request)
    try:
        return await localization_service.on_demand(
            db, redis, settings, hydrator, poi_id=body.poi_id, lang=body.lang, client=_client(request)
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TtsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/localizations/warmup", status_code=202)
@router.post("/warmup", status_code=202, include_in_schema=False)
async def warmup(request: Request, body: WarmupRequest | None = None):
    """Full-corpus hydration in the background."""
    db, redis, settings, hydrator = _deps(request)
    return await localization_service.warmup(
        db, redis, settings, hydrator, lang=body.lang if body else None, client=_client(request)
    )
