"""Cấu hình test: dùng SQLite trong bộ nhớ nên KHÔNG cần MySQL và KHÔNG cần internet."""
import os

# Phải đặt TRƯỚC khi import app
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "khoa-bi-mat-cho-test"

import pytest
from fastapi.testclient import TestClient

import app.models  # noqa: F401
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import AdminUser, Language, Region
from app.services import audio_pipeline_service


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    """Mỗi test bắt đầu với database sạch + dữ liệu nền (miền, ngôn ngữ, 1 admin)."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.add_all([
            Region(code="north", name_vi="Miền Bắc"),
            Region(code="central", name_vi="Miền Trung"),
            Region(code="south", name_vi="Miền Nam"),
            Language(code="vi", name="Tiếng Việt", tts_voice="vi-VN-HoaiMyNeural"),
            Language(code="en", name="English", tts_voice="en-US-JennyNeural"),
            AdminUser(username="admin", password_hash=hash_password("matkhau123"), role="super_admin"),
        ])
        db.commit()
    # Không gọi dịch/TTS thật khi test (cần internet)
    monkeypatch.setattr(audio_pipeline_service, "generate_for_poi", lambda *a, **k: None)
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_headers(client):
    res = client.post("/api/v1/admin/auth/login", json={"username": "admin", "password": "matkhau123"})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}
