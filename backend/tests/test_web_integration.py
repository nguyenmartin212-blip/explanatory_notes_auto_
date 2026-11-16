from uuid import uuid4

from sqlalchemy import inspect, select
from sqlalchemy.exc import OperationalError

from app.core.exceptions import TranslateError, TTSError
from app.database import Base, CORE_TABLES, SessionLocal, check_schema, engine
from app.models import Category, POI, PoiLocalization
from app.models.web import AudioTask
from app.services.audio_worker import process
from app.services import audio_pipeline_service, translate_service, tts_service
from app.stores.audio_task_store import AudioTaskStore, claim
from tests.test_api import POI_PAYLOAD, add_english_ready


def test_web_login_visits_and_device_report(client):
    with SessionLocal.begin() as db:
        subject = POI(**POI_PAYLOAD, is_active=True)
        db.add(subject)
        db.flush()
        poi_key = f"poi-{subject.id}"
    pois = client.get("/pois").json()
    assert len(pois) == 1
    assert pois[0]["name"]["vi"]
    assert pois[0]["id"] == poi_key

    assert client.get("/admin/visitor-visits").status_code == 401
    assert client.get("/api/analytics/usage").status_code == 401
    login = client.post("/admin/auth/login", json={"username": "admin", "password": "matkhau123"})
    assert login.status_code == 200
    assert login.json()["user"]["permissions"] == ["*"]
    assert client.post("/admin/auth/refresh").status_code == 200
    assert client.get("/admin/auth/me").status_code == 200
    assert client.get("/admin/users").json()["total"] == 1

    key = str(uuid4())
    arrival = {"visit_id": key, "poi_id": poi_key}
    assert client.post("/api/visitors/check-in", json=arrival).json()["status"] == "inside"
    assert client.post("/api/visitors/check-in", json=arrival).status_code == 200
    itinerary = {"visit_id": key, "poi_ids": [poi_key]}
    assert client.post("/api/visitors/itinerary", json=itinerary).json()["saved_itinerary"]["poi_ids"] == itinerary["poi_ids"]
    assert client.post("/api/visitors/check-out", json={"visit_id": key}).json()["status"] == "exited"
    assert client.get("/admin/visitor-visits").json()["total"] == 1

    pulse = {"device_id": "test-device"}
    assert client.post("/api/analytics/devices/heartbeat", json=pulse).json()["session_started"]
    assert not client.post("/api/analytics/devices/heartbeat", json=pulse).json()["session_started"]
    report = client.get("/api/analytics/usage?period=month").json()
    assert report["active_device_count"] == report["total_sessions"] == 1
    assert client.get("/api/analytics/usage?from=2026-11-12").status_code == 422
    assert client.post("/admin/auth/logout").status_code == 200
    assert client.get("/admin/auth/me").status_code == 401


def test_extra_queue_recovers_and_finishes(client, admin_headers, monkeypatch):
    assert client.get("/api/v1/admin/pois/audio-tasks/stream").status_code == 401
    created = client.post("/api/v1/admin/pois", json=POI_PAYLOAD, headers=admin_headers)
    assert created.status_code == 201
    job = claim()
    assert job[1] == created.json()["id"]
    assert AudioTaskStore.list_recent(1)[0]["status"] == "running"
    assert AudioTaskStore.requeue_all_running() == 1
    assert AudioTaskStore.requeue_all_running() == 0
    retry = claim()
    assert retry == job

    def fake_audio(poi_id, langs, translate, *, on_progress):
        assert poi_id == created.json()["id"]
        on_progress(50)
        return True

    monkeypatch.setattr(audio_pipeline_service, "generate_for_poi", fake_audio)
    process(retry)
    with SessionLocal() as db:
        task = db.scalar(select(AudioTask))
        assert task.status == "completed" and task.progress == 100
        assert db.get(POI, task.poi_id) is not None


def test_poi_catalog_region_gallery_and_offline_version(client, admin_headers):
    with SessionLocal.begin() as db:
        db.add(Category(id=1, name_vi="Di tích"))
    base = "/api/v1/admin/pois"
    assert client.get(f"{base}/categories").status_code == 401
    assert client.get(f"{base}/categories", headers=admin_headers).json() == [{"id": 1, "name_vi": "Di tích"}]
    bad = client.post(base, headers=admin_headers, json={**POI_PAYLOAD, "category_id": 999})
    assert bad.status_code == 400
    images = ["/static/images/first.webp", "https://example.com/second.webp"]
    payload = {**POI_PAYLOAD, "region_id": 2, "category_id": 1, "image_urls": images}
    created = client.post(base, headers=admin_headers, json=payload)
    assert created.status_code == 201
    poi_id = created.json()["id"]
    assert created.json()["image_urls"] == images
    add_english_ready(poi_id)
    assert client.patch(f"{base}/{poi_id}/activation", headers=admin_headers, json={"is_active": True}).status_code == 200
    item, = client.get("/api/v1/pois?lang=ja&region=central").json()
    assert item["id"] == poi_id and item["region_code"] == "central"
    assert item["lang"] == "en" and item["is_fallback"] is True
    assert item["image_urls"] == images
    assert client.get(f"/api/v1/pois/{poi_id}?lang=ja").json() == item
    manifest = "/api/v1/offline/manifest?lang=ja&region=central"
    first = client.get(manifest).json()
    assert first["items"][0]["image_urls"] == images
    assert client.put(f"{base}/{poi_id}", headers=admin_headers, json={"image_urls": images[::-1]}).status_code == 200
    second = client.get(manifest).json()
    assert second["version"] != first["version"]
    assert second["items"][0]["image_urls"] == images[::-1]


def test_admin_cookie_and_token_failures(client, admin_headers):
    assert client.get("/api/v1/admin/pois", headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.post("/api/v1/admin/auth/users", headers=admin_headers, json={
        "username": "operator", "password": "test-password", "role": "admin",
    }).status_code == 201
    assert client.post("/admin/auth/login", json={"username": "operator", "password": "test-password"}).status_code == 200
    assert client.get("/api/v1/admin/pois").status_code == 200
    assert client.get("/api/v1/admin/auth/users").status_code == 403
    assert client.post("/admin/auth/logout").status_code == 200
    assert client.post("/admin/auth/refresh").status_code == 401
    assert client.get("/api/v1/admin/pois").status_code == 401


def test_audio_task_validation_and_translation_failure(client, admin_headers, monkeypatch):
    base = "/api/v1/admin/pois"
    poi_id = client.post(base, headers=admin_headers, json=POI_PAYLOAD).json()["id"]
    endpoint = f"{base}/{poi_id}/generate-audio"
    for langs in ([], ["unknown"]):
        assert client.post(endpoint, headers=admin_headers, json={"langs": langs}).status_code == 422
    response = client.post(endpoint, headers=admin_headers, json={"langs": ["en", "en"]})
    assert response.status_code == 202
    task_id = int(response.json()["task_id"])
    with SessionLocal() as db:
        assert db.get(AudioTask, task_id).langs == ["en"]

    def failed_translation(*args):
        raise TranslateError("offline translation service")

    monkeypatch.setattr(translate_service, "translate_text", failed_translation)
    # Run the real per-language logic with a deterministic external-service failure.
    with SessionLocal() as db:
        try:
            audio_pipeline_service._process_language(db, poi_id, "en", "voice", True)
        except TranslateError:
            pass
        else:
            raise AssertionError("translation errors must reach the worker")
    assert client.get(f"{base}/{poi_id}/localizations", headers=admin_headers).json() == []


def test_worker_preserves_manual_edit_during_translation_and_tts(client, admin_headers, monkeypatch):
    base = "/api/v1/admin/pois"
    poi_id = client.post(base, headers=admin_headers, json=POI_PAYLOAD).json()["id"]
    endpoint = f"{base}/{poi_id}/localizations/en"
    manual = {"name": "Manual name", "description": "An editor's manual translation."}
    first = True

    def edit_during_translation(*args):
        nonlocal first
        if first:
            first = False
            assert client.put(endpoint, headers=admin_headers, json=manual).status_code == 200
        return "Outdated machine translation"

    monkeypatch.setattr(translate_service, "translate_text", edit_during_translation)
    with SessionLocal() as db:
        audio_pipeline_service._process_language(db, poi_id, "en", "voice", True)
    newest = {"name": "New manual name", "description": "The latest manual translation."}

    def edit_during_tts(*args):
        assert client.put(endpoint, headers=admin_headers, json=newest).status_code == 200
        raise TTSError("unavailable")

    monkeypatch.setattr(tts_service, "make_audio", edit_during_tts)
    with SessionLocal() as db:
        try:
            audio_pipeline_service._process_language(db, poi_id, "en", "voice", False)
        except TTSError:
            pass
        loc = db.scalar(select(PoiLocalization).where(PoiLocalization.poi_id == poi_id))
        assert loc.name == newest["name"] and not loc.is_machine_translated
        assert loc.audio_status == "processing"


def test_readiness_reports_database_failure(client, monkeypatch):
    def unavailable():
        raise OperationalError("SELECT 1", {}, RuntimeError("unavailable"))

    monkeypatch.setattr(engine, "connect", unavailable)
    assert client.get("/health/ready").status_code == 503


def test_core_schema_runs_without_ddl_or_extra_tables(client, monkeypatch):
    extras = [table for table in Base.metadata.sorted_tables if table.name not in CORE_TABLES]
    Base.metadata.drop_all(bind=engine, tables=extras)
    assert check_schema(engine) == CORE_TABLES
    assert "address" not in {column["name"] for column in inspect(engine).get_columns("pois")}
    assert client.get("/api/v1/pois").json() == []
    fail = client.post("/api/v1/analytics/session", json={"device_id": "device-01", "qr_code": "not-registered"}).json()
    assert fail["qr_valid"] is False and fail["session_id"] is None and fail["web_visits"] is False
    login = client.post("/admin/auth/login", json={"username": "admin", "password": "matkhau123"})
    assert login.status_code == 200
    assert login.json()["user"]["features"]["audio_queue"] is False
    assert client.post("/admin/auth/refresh").status_code == 200
    assert client.get("/api/v1/admin/stats/summary").json()["total_sessions"] == 0
    created = client.post("/api/v1/admin/pois", json=POI_PAYLOAD)
    assert created.status_code == 201
    response = client.post(f"/api/v1/admin/pois/{created.json()['id']}/generate-audio", json={"langs": ["en"]})
    assert response.status_code == 202 and response.json()["task_id"] is None
    assert client.get("/api/v1/admin/pois/audio-tasks/stream").status_code == 503
    assert client.post("/admin/auth/logout").status_code == 200
    assert client.get("/admin/auth/me").status_code == 401
    assert set(inspect(engine).get_table_names()) == CORE_TABLES
