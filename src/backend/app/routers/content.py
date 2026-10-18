from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse, Response

from app.core.config import get_settings
from app.services import poi_nearby, poi_sync

# Paths: /poi/load-all, /poi/nearby (Chapter 05) and /pois (the path the FE calls: src/features/poi/api.ts)
router = APIRouter(tags=["content"])

Language = Literal["vi", "en", "zh", "ja", "ko"]
SyncMode = Literal["auto", "full", "delta"]


@router.get("/poi/load-all")
async def load_all(
    request: Request,
    lang: Language | None = Query(default=None, description="Adds `content` resolved with fallback lang -> en -> vi"),
    sync_mode: SyncMode = Query(default="auto"),
    sync_cursor: str | None = Query(default=None),
    updated_after: datetime | None = Query(default=None),
    if_none_match: str | None = Header(default=None),
):
    """All public POIs. Full sync, or delta sync when a cursor / updated_after is sent."""
    db = request.app.state.db

    version = await poi_sync.get_dataset_version(db)
    etag = poi_sync.make_etag(version, lang)
    if poi_sync.etag_matches(if_none_match, etag):
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})

    payload = await poi_sync.load_all(
        db,
        lang=lang,
        sync_mode=sync_mode,
        sync_cursor=sync_cursor,
        updated_after=updated_after,
    )
    etag = poi_sync.make_etag(payload["dataset_version"], lang)
    return JSONResponse(payload, headers={"ETag": etag, "Cache-Control": "no-cache"})


@router.get("/poi/nearby")
async def nearby(
    request: Request,
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius: int = Query(default=1000, ge=1, le=50000, description="Search radius in meters"),
    limit: int = Query(default=20, ge=1, le=100),
    lang: Language | None = Query(default=None),
):
    """Public POIs around a point, nearest first."""
    return await poi_nearby.find_nearby(
        request.app.state.db, lat=lat, lng=lng, radius_m=radius, limit=limit, lang=lang
    )


@router.get("/pois")
async def pois(request: Request, if_none_match: str | None = Header(default=None)):
    """Public POIs as the FE `Poi[]` (camelCase, localized maps, absolute audio URLs)."""
    db = request.app.state.db
    version = await poi_sync.get_dataset_version(db)
    etag = poi_sync.make_etag(version, "fe")
    if poi_sync.etag_matches(if_none_match, etag):
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})

    base_url = get_settings().public_base_url or str(request.base_url)
    payload = await poi_sync.load_client_pois(db, base_url)
    return JSONResponse(payload, headers={"ETag": etag, "Cache-Control": "no-cache"})
