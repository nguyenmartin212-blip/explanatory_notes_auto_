"""GET /poi/nearby: $geoNear first, Haversine as fallback."""

from __future__ import annotations

import logging

from app.core.errors import GeoQueryUnavailable
from app.services.poi_payload import build_poi_payload, poi_coordinates
from app.stores import poi_localization_store, poi_store
from app.utils.geo import haversine_m

logger = logging.getLogger(__name__)


async def find_candidates(
    db, *, lat: float, lng: float, radius_m: int, limit: int
) -> tuple[str, list[tuple[dict, float]]]:
    """Active POIs within `radius_m`, nearest first: ($geoNear | Haversine, [(poi, distance_m)])."""
    source = "geoNear"
    try:
        found = await poi_store.geo_near(
            db, lat=lat, lng=lng, max_distance_m=radius_m, limit=limit
        )
    except GeoQueryUnavailable as exc:
        logger.warning("$geoNear unavailable, falling back to Haversine: %s", exc)
        source = "haversine"
        found = []
        for poi in await poi_store.list_active(db):
            poi_lat, poi_lng = poi_coordinates(poi)
            distance = haversine_m(lat, lng, poi_lat, poi_lng)
            if distance <= radius_m:
                found.append((poi, distance))
        found.sort(key=lambda item: (item[1], -item[0].get("priority", 0), item[0]["poi_id"]))
        found = found[:limit]
    return source, found


async def find_nearby(
    db, *, lat: float, lng: float, radius_m: int, limit: int, lang: str | None
) -> dict:
    source, found = await find_candidates(db, lat=lat, lng=lng, radius_m=radius_m, limit=limit)
    locs = await poi_localization_store.list_for_pois(db, [poi["poi_id"] for poi, _ in found])
    items = []
    for poi, distance in found:
        payload = build_poi_payload(poi, locs.get(poi["poi_id"], {}), lang)
        payload["distance_m"] = round(distance, 1)
        payload["inside_radius"] = distance <= poi["radius_meters"]
        items.append(payload)
    return {"source": source, "count": len(items), "pois": items}
