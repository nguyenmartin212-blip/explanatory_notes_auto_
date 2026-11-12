"""Sinh (hoặc sinh lại) bản dịch + audio cho TẤT CẢ điểm tham quan.
Chạy trong thư mục backend:   python -m scripts.generate_all_audio
Cần có internet. Nội dung không đổi thì audio được lấy từ cache, không sinh lại.
"""
import logging

import app.models  # noqa: F401
from app.database import SessionLocal
from app.services import audio_pipeline_service
from app.stores import poi_store

logging.basicConfig(level=logging.INFO, format="%(message)s")


def main() -> None:
    with SessionLocal() as db:
        poi_ids = [p.id for p in poi_store.list_all(db, limit=10000)]

    for i, poi_id in enumerate(poi_ids, start=1):
        print(f"[{i}/{len(poi_ids)}] Điểm #{poi_id} ...")
        audio_pipeline_service.generate_for_poi(poi_id)
    print("Xong.")


if __name__ == "__main__":
    main()
