"""Public catalog and regional offline downloads."""

from hashlib import sha256
import json
from typing import Literal

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.schemas.content import Region
from app.services import poi_nearby, poi_payload, poi_sync
from app.stores import poi_localization_store, poi_store

router = APIRouter(prefix="/api/v1", tags=["catalog and offline"])
Language = Literal["vi", "en", "zh", "ja", "ko"]
REGIONS = {"north": "Miền Bắc", "central": "Miền Trung", "south": "Miền Nam"}
LANGUAGES = {"vi": "Tiếng Việt", "en": "English", "zh": "中文", "ja": "日本語", "ko": "한국어"}


def base_url(request):
    return get_settings().public_base_url or str(request.base_url)


def public_poi(poi, locs, lang, url):
    payload = poi_payload.build_poi_payload(poi, locs, lang)
    content = payload["content"]
    if content:
        content["audio_url"] = poi_payload.absolute_url(url, content["audio_url"])
    return payload


@router.get("/regions")
async def regions():
    return [{"code": code, "name_vi": name} for code, name in REGIONS.items()]


@router.get("/languages")
async def languages():
    return [{"code": code, "name": name} for code, name in LANGUAGES.items()]


@router.get("/pois")
async def list_pois(
    request: Request, region: Region | None = None, lang: Language = "vi",
    skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
):
    db = request.app.state.db
    pois = await poi_store.list_active_region(db, region, skip=skip, limit=limit)
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p in pois])
    return [public_poi(p, locs.get(p["poi_id"], {}), lang, base_url(request)) for p in pois]


@router.get("/pois/nearby")
async def nearby(
    request: Request, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
    radius: int = Query(1500, ge=1, le=10000), limit: int = Query(50, ge=1, le=200),
    lang: Language = "vi",
):
    result = await poi_nearby.find_nearby(
        request.app.state.db, lat=lat, lng=lng, radius_m=radius, limit=limit, lang=lang
    )
    items = result["pois"]
    for item in items:
        item["inside_trigger"] = item["inside_radius"]
        if item["content"]:
            item["content"]["audio_url"] = poi_payload.absolute_url(
                base_url(request), item["content"]["audio_url"]
            )
    items.sort(key=lambda item: (
        not item["inside_trigger"], -item["priority"] if item["inside_trigger"] else 0,
        item["distance_m"], item["poi_id"],
    ))
    return items


@router.get("/pois/{poi_id}")
async def poi_detail(poi_id: str, request: Request, lang: Language = "vi"):
    db = request.app.state.db
    poi = await poi_store.get(db, poi_id)
    if not poi or poi["status"] != poi_store.STATUS_ACTIVE:
        raise NotFoundError("Điểm tham quan không tồn tại")
    locs = await poi_localization_store.list_for_poi(db, poi_id)
    return public_poi(poi, locs, lang, base_url(request))


async def offline_data(request, lang, region):
    db = request.app.state.db
    pois = await poi_store.list_active_region(db, region)
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p in pois])
    items = []
    for poi in pois:
        translations = locs.get(poi["poi_id"], {})
        item = public_poi(poi, translations, lang, base_url(request))
        item.pop("localizations")
        content = item["content"]
        audio = translations.get(content["language_served"], {}) if content and content["audio_url"] else {}
        item["audio_bytes"] = audio.get("audio_size")
        item["audio_sha256"] = audio.get("audio_sha256")
        items.append(item)
    version = sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()[:24]
    return {
        "version": version, "lang": lang, "region": region, "poi_count": len(items),
        "total_audio_bytes": sum(item["audio_bytes"] or 0 for item in items),
        "items": items,
    }


@router.get("/offline/manifest")
async def offline_manifest(
    request: Request, lang: Language = "vi", region: Region | None = None,
    if_none_match: str | None = Header(default=None),
):
    payload = await offline_data(request, lang, region)
    etag = f'W/"offline-{payload["version"]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if poi_sync.etag_matches(if_none_match, etag):
        return Response(status_code=304, headers=headers)
    return JSONResponse(payload, headers=headers)


@router.get("/offline/version")
async def offline_version(request: Request, lang: Language = "vi", region: Region | None = None):
    payload = await offline_data(request, lang, region)
    return {key: payload[key] for key in ("lang", "region", "version", "poi_count")}
