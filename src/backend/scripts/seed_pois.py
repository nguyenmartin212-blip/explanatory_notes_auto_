"""Seed the 3 demo POIs of the app (same data as the FE `src/features/poi/mockData.ts`).

    python -m scripts.seed_pois            # create/update the POIs and make them public
    python -m scripts.seed_pois --draft    # create/update them but keep them private

Safe to run any number of times: a POI is created only if its id does not exist,
otherwise it is updated in place (upsert by poi_id; localizations by (poi_id, language)).
Nothing is duplicated, an unchanged POI does not change `dataset_version`, and an
audio file is regenerated only if its text changed.

The demo data has no audio, so these POIs do not meet the normal activation rule
(English audio ready); the script activates them with `force=True`. Audio tasks are
queued automatically and are processed when the API server runs; until then the app
falls back to the device TTS (it reads `ttsScript`).
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from app.core.errors import NotFoundError
from app.schemas.content import PoiCreate, PoiUpdate
from app.services import content_service
from app.stores import audio_task_store, poi_dataset_store, poi_localization_store, poi_store

logger = logging.getLogger("seed_pois")

# Copied from the FE mockData.ts (the FE is the source of truth for this data).
DEMO_POIS: list[dict] = [
    {
        "poi_id": "hanoi-thang-long",
        "latitude": 21.0353,
        "longitude": 105.8402,
        "radius_meters": 80,
        "priority": 10,
        "images": [],
        "map_url": "https://www.google.com/maps/search/?api=1&query=21.0353,105.8402",
        "localizations": {
            "vi": {
                "name": "Hoàng thành Thăng Long",
                "description": "Quần thể di sản giữa lòng Hà Nội, nơi lưu giữ nhiều lớp dấu tích của các triều đại Việt Nam.",
                "tts_script": "Hoàng thành Thăng Long là không gian di sản lịch sử tiêu biểu tại Hà Nội.",
            },
            "en": {
                "name": "Imperial Citadel of Thang Long",
                "description": "A heritage complex in the heart of Hanoi preserving traces of successive Vietnamese dynasties.",
                "tts_script": "The Imperial Citadel of Thang Long is an important historic heritage site in Hanoi.",
            },
            "zh": {
                "name": "升龙皇城",
                "description": "位于河内市中心的历史遗产群，保留着越南多个朝代的历史印记。",
                "tts_script": "升龙皇城是河内重要的历史文化遗产。",
            },
        },
    },
    {
        "poi_id": "hue-imperial-city",
        "latitude": 16.4690,
        "longitude": 107.5788,
        "radius_meters": 120,
        "priority": 10,
        "images": [],
        "map_url": "https://www.google.com/maps/search/?api=1&query=16.4690,107.5788",
        "localizations": {
            "vi": {
                "name": "Đại Nội Huế",
                "description": "Không gian kiến trúc cung đình của triều Nguyễn, gắn với lịch sử cố đô Huế.",
                "tts_script": "Đại Nội Huế là một phần quan trọng của quần thể di tích Cố đô Huế.",
            },
            "en": {
                "name": "Hue Imperial City",
                "description": "The Nguyen dynasty imperial complex, closely connected with the history of Hue.",
                "tts_script": "Hue Imperial City is a central part of the Complex of Hue Monuments.",
            },
            "zh": {
                "name": "顺化皇城",
                "description": "阮朝的宫廷建筑群，与顺化古都的历史密切相关。",
                "tts_script": "顺化皇城是顺化古迹群的重要组成部分。",
            },
        },
    },
    {
        "poi_id": "saigon-ben-thanh",
        "latitude": 10.7721,
        "longitude": 106.6983,
        "radius_meters": 90,
        "priority": 8,
        "images": [],
        "map_url": "https://www.google.com/maps/search/?api=1&query=10.7721,106.6983",
        "localizations": {
            "vi": {
                "name": "Chợ Bến Thành",
                "description": "Một biểu tượng thương mại và đời sống đô thị của Thành phố Hồ Chí Minh.",
                "tts_script": "Chợ Bến Thành là một trong những địa điểm quen thuộc tại trung tâm Thành phố Hồ Chí Minh.",
            },
            "en": {
                "name": "Ben Thanh Market",
                "description": "An iconic market representing the commercial and urban life of Ho Chi Minh City.",
                "tts_script": "Ben Thanh Market is one of the most recognizable places in central Ho Chi Minh City.",
            },
            "zh": {
                "name": "滨城市场",
                "description": "胡志明市具有代表性的市场，展现当地商业与城市生活。",
                "tts_script": "滨城市场是胡志明市中心最具代表性的地点之一。",
            },
        },
    },
]


async def seed(db, settings, *, activate: bool = True) -> dict[str, str]:
    """Upsert the demo POIs. Returns {poi_id: 'created' | 'updated'}."""
    result: dict[str, str] = {}
    for data in DEMO_POIS:
        poi_id = data["poi_id"]
        try:
            await content_service.update_poi(db, settings, poi_id, PoiUpdate(**{k: v for k, v in data.items() if k != "poi_id"}))
            result[poi_id] = "updated"
        except NotFoundError:
            await content_service.create_poi(db, settings, PoiCreate(**data))
            result[poi_id] = "created"
        if activate:
            await content_service.activate_poi(db, poi_id, force=True)
    return result


async def ensure_indexes(db) -> None:
    for store in (poi_store, poi_localization_store, poi_dataset_store, audio_task_store):
        await store.ensure_indexes(db)


async def main(activate: bool) -> None:
    from app.core.config import get_settings
    from app.db.mongo import connect_mongo

    settings = get_settings()
    client, db = await connect_mongo(settings)
    try:
        await ensure_indexes(db)
        for poi_id, outcome in (await seed(db, settings, activate=activate)).items():
            logger.info("%s: %s%s", poi_id, outcome, " (public)" if activate else " (draft)")
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the demo POIs (idempotent).")
    parser.add_argument("--draft", action="store_true", help="keep the POIs private (do not activate)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main(activate=not args.draft))
