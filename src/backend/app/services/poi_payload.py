"""Builds the public JSON shape of a POI (shared by load-all and nearby)."""

from __future__ import annotations

from datetime import datetime

from app.services.localization_fallback import (
    fallback_chain,
    has_valid_audio,
    is_usable,
    narration_text,
    public_localization,
    resolve_content,
)

# Languages of the FE `Poi` type (src/types/localized.ts: SupportedLanguage)
FE_LANGUAGES = ("vi", "en", "zh", "ko")


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def poi_coordinates(poi: dict) -> tuple[float, float]:
    """Return (lat, lng) from the GeoJSON [lng, lat] location."""
    lng, lat = poi["location"]["coordinates"]
    return lat, lng


def build_poi_payload(poi: dict, localizations: dict[str, dict], lang: str | None) -> dict:
    lat, lng = poi_coordinates(poi)
    payload = {
        "poi_id": poi["poi_id"],
        "latitude": lat,
        "longitude": lng,
        "radius_meters": poi["radius_meters"],
        "priority": poi.get("priority", 0),
        "images": poi.get("images", []),
        "map_url": poi.get("map_url"),
        "dataset_version": poi.get("dataset_version"),
        "updated_at": iso(poi.get("updated_at")),
        "localizations": {
            language: public_localization(loc)
            for language, loc in sorted(localizations.items())
            if is_usable(loc)
        },
    }
    if lang:
        payload["content"] = resolve_content(localizations, lang)
    return payload


def absolute_url(base_url: str, url: str | None) -> str | None:
    """The FE plays `audio` from a URI, so it must be absolute."""
    if not url:
        return None
    if url.startswith(("http://", "https://")):
        return url
    return f"{base_url.rstrip('/')}/{url.lstrip('/')}"


def build_client_poi(poi: dict, localizations: dict[str, dict], base_url: str) -> dict:
    """The POI exactly as the FE type `Poi` (src/features/poi/types.ts):

        id, name, description (LocalizedText: `vi` always present), latitude, longitude,
        radiusMeters, priority, images, mapUrl?, audio?, ttsScript?

    Only the FE languages are sent. A missing Vietnamese text is filled from the
    fallback chain (vi -> en) because the FE type requires `vi`.
    """
    lat, lng = poi_coordinates(poi)
    usable = {lang: loc for lang, loc in localizations.items() if lang in FE_LANGUAGES and is_usable(loc)}
    fallback = next((localizations[l] for l in fallback_chain("vi") if is_usable(localizations.get(l))), None)

    name = {lang: loc["name"] for lang, loc in sorted(usable.items())}
    description = {lang: loc["description"] for lang, loc in sorted(usable.items())}
    if "vi" not in usable:
        name["vi"] = (fallback or {}).get("name", poi["poi_id"])
        description["vi"] = (fallback or {}).get("description", "")

    out = {
        "id": poi["poi_id"],
        "name": name,
        "description": description,
        "latitude": lat,
        "longitude": lng,
        "radiusMeters": poi["radius_meters"],
        "priority": poi.get("priority", 0),
        "images": list(poi.get("images", [])),
    }
    if poi.get("map_url"):
        out["mapUrl"] = poi["map_url"]

    audio = {
        lang: absolute_url(base_url, loc["audio_url"])
        for lang, loc in sorted(usable.items())
        if has_valid_audio(loc)
    }
    if audio:
        out["audio"] = audio

    scripts = {
        lang: loc["tts_script"].strip()
        for lang, loc in sorted(usable.items())
        if (loc.get("tts_script") or "").strip()
    }
    if scripts:
        if "vi" not in scripts:
            scripts["vi"] = narration_text(fallback or {})
        out["ttsScript"] = scripts
    return out
