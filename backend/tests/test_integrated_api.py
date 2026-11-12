"""Exercise the merged HTTP API with MongoDB and Redis stand-ins."""

from asyncio import Lock
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

from app.auth.passwords import default_hasher
from app.core.config import Settings
from app.core.errors import GeoQueryUnavailable
from app.db.collections import AUDIO_TASKS
from app.main import create_app
from app.services import audio_sse, content_service, localization_service
from app.services.audio_recovery import recover_audio_tasks
from app.services.audio_task_manager import AudioTaskManager
from app.services.seeding import run_seeding
from app.startup import mount_api
from app.stores import audio_task_store, poi_localization_store, poi_store


class RedisLock:
    def __init__(self, lock):
        self.lock = lock

    async def acquire(self):
        await self.lock.acquire()
        return True

    async def release(self):
        self.lock.release()


class RedisDouble:
    def __init__(self):
        self.values = {}
        self.mutation_lock = Lock()

    def lock(self, *args, **kwargs):
        return RedisLock(self.mutation_lock)

    async def exists(self, key):
        return key in self.values

    async def set(self, key, value, *, ex, nx):
        if key in self.values:
            return False
        self.values[key] = value
        return True

    async def incr(self, key):
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    async def ttl(self, key):
        return 60

    async def expire(self, key, seconds):
        return True


@pytest_asyncio.fixture
async def api(tmp_path, monkeypatch):
    monkeypatch.setattr(default_hasher, "rounds", 4)
    settings = Settings(
        _env_file=None, app_env="development", public_base_url="",
        superadmin_bootstrap_mode="env", superadmin_username="bootstrap",
        superadmin_password="bootstrap-test-password",
        runtime_dir=tmp_path, static_dir=tmp_path / "static",
        media_dir=tmp_path / "media", tts_cache_dir=tmp_path / "cache",
    )
    db = AsyncMongoMockClient(tz_aware=True).test_db
    redis = RedisDouble()
    app = create_app()
    app.state.db = db
    app.state.redis = redis
    app.state.localization = localization_service.LocalizationHydrator(db, settings, None, redis)
    app.state.audio_tasks = AudioTaskManager(db, settings, None)
    monkeypatch.setattr("app.routers.admin.get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.catalog.get_settings", lambda: settings)
    monkeypatch.setattr("app.auth.dependencies.get_settings", lambda: settings)
    await run_seeding(db, settings)
    mount_api(app, settings)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield SimpleNamespace(client=client, db=db, app=app, settings=settings)


@pytest.mark.asyncio
async def test_web_admin_cors_supports_credentials(monkeypatch):
    settings = Settings(_env_file=None, app_env="development", cors_allow_origins="")
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:3000") as client:
        allowed = await client.options("/admin/auth/login", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert allowed.status_code == 200
        assert allowed.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert allowed.headers["Access-Control-Allow-Credentials"] == "true"

        denied = await client.options("/admin/auth/login", headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "POST",
        })
        assert denied.status_code == 400
        assert "Access-Control-Allow-Origin" not in denied.headers


async def login(client, username="bootstrap", password="bootstrap-test-password"):
    response = await client.post("/admin/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


async def create_draft(api, poi_id="demo-site"):
    response = await api.client.post("/admin/pois", json={
        "poi_id": poi_id, "latitude": 21, "longitude": 105,
        "region_code": "north", "category": "heritage",
        "localizations": {
            "vi": {"name": "Di tích", "description": "Nội dung tiếng Việt"},
            "en": {"name": "Heritage", "description": "English narration"},
        },
    })
    assert response.status_code == 201, response.text
    return response.json()


async def publish(api, poi_id="demo-site"):
    loc = await poi_localization_store.get(api.db, poi_id, "en")
    await content_service.complete_audio(
        api.db, api.settings, poi_id=poi_id, language="en", content_hash=loc["content_hash"],
        audio_path="test.mp3", audio_url="/media/test.mp3", audio_size=10, audio_sha256="a" * 64,
    )
    response = await api.client.post(f"/admin/pois/{poi_id}/activate")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_catalog_offline_and_delta_removal(api, monkeypatch):
    client = api.client
    await login(client)
    await create_draft(api)
    assert (await client.get("/api/v1/pois/demo-site")).status_code == 404
    assert (await client.post("/admin/pois/demo-site/activate")).status_code == 409
    await publish(api)

    assert (await client.get("/pois")).json()[0]["id"] == "demo-site"
    filtered = (await client.get("/api/v1/pois?region=north&lang=ja")).json()
    assert filtered[0]["region_code"] == "north"
    assert filtered[0]["content"]["language_served"] == "en"
    assert (await client.get("/api/v1/pois?region=south")).json() == []

    async def force_haversine(*args, **kwargs):
        raise GeoQueryUnavailable("mock DB")

    monkeypatch.setattr(poi_store, "geo_near", force_haversine)
    nearby = (await client.get("/api/v1/pois/nearby?lat=21&lng=105")).json()
    assert nearby[0]["inside_trigger"] is True

    manifest_url = "/api/v1/offline/manifest?region=north&lang=en"
    manifest = await client.get(manifest_url)
    assert manifest.json()["total_audio_bytes"] == 10
    assert (await client.get(manifest_url, headers={"If-None-Match": manifest.headers["ETag"]})).status_code == 304
    assert (await client.get("/audio/pack-manifest?lang=en")).json()["files"][0]["sha256"] == "a" * 64
    cursor = (await client.get("/poi/load-all")).json()["sync_cursor"]
    response = await client.patch("/admin/pois/demo-site/activation", json={"is_active": False})
    assert response.json()["status"] == "draft"
    delta = await client.get("/poi/load-all", params={"sync_cursor": cursor})
    assert delta.json()["removed_poi_ids"] == ["demo-site"]
    assert (await client.get(manifest_url)).json()["version"] != manifest.json()["version"]


@pytest.mark.asyncio
async def test_qr_analytics_and_visitor_itinerary(api):
    client = api.client
    assert (await client.get("/api/v1/admin/stats/summary")).status_code == 401
    await login(client)
    await create_draft(api)
    await publish(api)
    qr_data = {"code": "demo-qr", "label": "Entrance", "poi_id": "demo-site"}
    qr = await client.post("/api/v1/admin/qr", json=qr_data)
    assert qr.status_code == 201, qr.text
    assert (await client.post("/api/v1/admin/qr", json=qr_data)).status_code == 409
    body = {"device_id": "anonymous-1", "lang_code": "en", "qr_code": "demo-qr"}
    session = await client.post("/api/v1/analytics/session", json=body)
    assert session.json()["poi_id"] == "demo-site"
    session_id = session.json()["session_id"]
    assert (await client.post("/api/v1/analytics/heartbeat", json={"session_id": session_id})).status_code == 200
    assert (await client.post("/api/v1/analytics/event", json={
        "session_id": session_id, "event_type": "play_audio", "poi_id": "demo-site",
    })).status_code == 201
    await client.post("/api/v1/analytics/session", json=body)
    report = await client.get("/api/v1/admin/stats/summary")
    assert report.status_code == 200, report.text
    assert report.json()["online_now"] == 1
    assert report.json()["total_qr_scans"] == 2
    assert report.json()["top_pois_by_plays"][0]["count"] == 1
    qr_path = f'/api/v1/admin/qr/{qr.json()["qr_id"]}'
    assert (await client.patch(qr_path, json={"is_active": False})).status_code == 200
    assert (await client.post("/api/v1/analytics/session", json=body)).json()["poi_id"] is None
    assert (await client.delete(qr_path)).status_code == 204

    visit = str(uuid4())
    assert (await client.post("/api/visitors/check-in", json={"visit_id": visit, "poi_id": "demo-site"})).status_code == 200
    itinerary = await client.post("/api/visitors/itinerary", json={"visit_id": visit, "poi_ids": ["demo-site"]})
    assert itinerary.status_code == 200, itinerary.text
    assert (await client.post("/api/visitors/check-out", json={"visit_id": visit})).status_code == 200


@pytest.mark.asyncio
async def test_account_lifecycle_and_token_revocation(api):
    client = api.client
    tokens = await login(client)
    root = {"Authorization": f'Bearer {tokens["access_token"]}'}
    root_id = (await client.get("/admin/auth/me", headers=root)).json()["user_id"]
    assert (await client.patch(f"/admin/users/{root_id}", headers=root, json={"is_active": False})).status_code == 409

    created = await client.post("/admin/users", headers=root, json={"username": "operator", "password": "operator-pass"})
    assert created.status_code == 201, created.text
    operator_id = created.json()["user_id"]
    assert "password_hash" not in created.json()
    operator = await login(client, "operator", "operator-pass")
    headers = {"Authorization": f'Bearer {operator["access_token"]}'}
    assert (await client.post("/admin/users", headers=headers, json={
        "username": "blocked", "password": "blocked-pass",
    })).status_code == 403
    assert (await client.post("/admin/auth/change-password", headers=headers, json={
        "old_password": "operator-pass", "new_password": "updated-password",
    })).status_code == 200
    assert (await client.get("/admin/auth/me", headers=headers)).status_code == 401

    assert (await client.post(f"/admin/users/{operator_id}/reset-password", headers=root,
                              json={"new_password": "reset-password"})).status_code == 200
    await login(client, "operator", "reset-password")
    assert (await client.patch(f"/admin/users/{operator_id}", headers=root, json={"is_active": False})).status_code == 200
    assert (await client.post("/admin/auth/login", json={"username": "operator", "password": "reset-password"})).status_code == 401
    assert (await client.delete(f"/admin/users/{operator_id}", headers=root)).status_code == 204


@pytest.mark.asyncio
async def test_device_analytics_http_contract(api, monkeypatch):
    client = api.client
    heartbeat_path = "/api/analytics/devices/heartbeat"
    report_path = "/api/analytics/usage"
    body = {"device_id": "browser:device.01", "device_name": "  Web  "}
    assert (await client.post(heartbeat_path, json=body)).status_code == 401
    assert (await client.get(report_path)).status_code == 401

    await login(client)
    admin = (await client.get("/admin/auth/me")).json()

    async def record(db, *, user_id, device_id, device_name, now):
        assert user_id == admin["user_id"]
        assert device_id == body["device_id"]
        assert device_name == "Web"
        return {"device_id": device_id, "device_name": device_name, "last_seen_at": now, "session_started": True}

    monkeypatch.setattr("app.stores.device_usage_store.record_heartbeat", record)
    assert (await client.post(heartbeat_path, json=body)).json()["session_started"] is True
    assert (await client.post(heartbeat_path, json={"device_id": "invalid id"})).status_code == 422
    for params in (
        {"period": "year"},
        {"from": "2026-11-01"},
        {"from": "2026-11-31", "to": "2026-12-01"},
        {"from": "2026-11-05", "to": "2026-11-01"},
    ):
        assert (await client.get(report_path, params=params)).status_code == 422
    report = await client.get(report_path, params={"period": "month", "from": "2026-11-01", "to": "2026-11-30"})
    assert report.status_code == 200, report.text
    assert report.json()["timezone"] == "UTC"
    assert report.json()["to"] == "2026-11-30"
    assert report.json()["total_sessions"] == 0

    await client.post("/admin/users", json={"username": "visitor", "password": "visitor-password", "role": "user"})
    await login(client, "visitor", "visitor-password")
    assert (await client.get(report_path)).status_code == 403


@pytest.mark.asyncio
async def test_audio_sse_snapshot_updates_keepalive_and_compatibility(api, monkeypatch):
    paths = ["/admin/audio-tasks/stream", "/api/v1/admin/pois/audio-tasks/stream"]
    for path in paths:
        assert (await api.client.get(path)).status_code == 401
    await login(api.client)
    await create_draft(api)
    actual_stream = audio_sse.event_stream

    async def finite_stream(db, *, is_disconnected, poll_seconds):
        task = (await audio_task_store.list_recent(db, 1))[0]
        elapsed = 0

        async def advance(seconds):
            nonlocal elapsed
            elapsed += 15
            if elapsed == 15:
                # MongoDB timestamps have millisecond precision. A change can share the timestamp.
                await db[AUDIO_TASKS].update_one({"task_id": task["task_id"]}, {"$inc": {"progress": 1}})

        stream = actual_stream(
            db, is_disconnected=is_disconnected, poll_seconds=poll_seconds,
            sleep=advance, clock=lambda: elapsed,
        )
        try:
            for _ in range(3):
                yield await anext(stream)
        finally:
            await stream.aclose()

    monkeypatch.setattr(audio_sse, "event_stream", finite_stream)
    for path in paths:
        response = await api.client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.text.startswith("event: snapshot\n")
        assert "event: task\n" in response.text
        assert response.text.endswith(": keepalive\n\n")


@pytest.mark.asyncio
async def test_draft_translation_manual_override_and_audio_recovery(api):
    await login(api.client)
    await create_draft(api)
    assert api.app.state.localization.pending_count == 5
    response = await api.client.post("/admin/pois/demo-site/generate-audio", json={"langs": ["ja"]})
    assert response.status_code == 202

    class Translator:
        async def translate(self, text, source, target):
            assert source == "vi"
            return f"{target} {text}"

    async def hydrate(lang):
        return await localization_service.hydrate_poi(
            api.db, api.settings, Translator(), "demo-site", lang, allow_draft=True
        )

    assert await hydrate("ja") == "translated"
    assert (await poi_localization_store.get(api.db, "demo-site", "ja"))["translated_from"] == "vi"
    await api.client.put("/admin/pois/demo-site/localizations/ja",
                         json={"name": "Manual", "description": "Manual translation"})
    assert await hydrate("ja") == "present"
    assert (await poi_localization_store.get(api.db, "demo-site", "ja"))["name"] == "Manual"

    interrupted = await audio_task_store.claim_next(api.db)
    assert interrupted["status"] == "running"
    assert await recover_audio_tasks(api.db) == 1
    task = f'/admin/audio-tasks/{interrupted["task_id"]}'
    paused = await api.client.post(task + "/pause")
    assert paused.status_code == 200, paused.text
    assert paused.json()["status"] == "paused"
    assert (await api.client.post(task + "/resume")).json()["status"] == "queued"
    assert (await api.client.post(task + "/cancel")).json()["status"] == "cancelled"
    assert (await api.client.post(task + "/retry")).json()["status"] == "queued"
