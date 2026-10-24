import pytest
from fastapi.testclient import TestClient

from app import startup
from app.core.config import Settings
from app.core.errors import StartupError
from app.core.security_guard import validate_security_config
from app.main import create_app
from app.routers import ROUTERS
from app.services.media_storage import check_media_storage
from app.services.seeding import prepare_runtime_storage
from app.workers.manager import WorkerManager

GOOD = {
    "jwt_secret": "a" * 40,
    "refresh_token_secret": "b" * 40,
    "secret_key": "c" * 40,
    "cccd_encryption_keys": "esoUhpHzT4Kdu7vX1VycxD_FpeUS0R7aM_a5aJ0fzOY=",
}


def make_settings(tmp_path, **overrides) -> Settings:
    values = {
        "_env_file": None,
        "app_env": "production",
        "runtime_dir": tmp_path / "runtime",
        "static_dir": tmp_path / "runtime" / "static",
        "tts_cache_dir": tmp_path / "runtime" / "tts-cache",
        "media_dir": tmp_path / "runtime" / "media",
        **GOOD,
        **overrides,
    }
    return Settings(**values)


# ---- Step 1: security guard -------------------------------------------------


def test_guard_skips_secrets_in_development(tmp_path):
    validate_security_config(make_settings(tmp_path, app_env="development", jwt_secret=""))


@pytest.mark.parametrize("field", ["jwt_secret", "refresh_token_secret", "secret_key"])
def test_guard_rejects_missing_secret_in_production(tmp_path, field):
    with pytest.raises(StartupError, match=field.upper()):
        validate_security_config(make_settings(tmp_path, **{field: ""}))


def test_guard_rejects_short_placeholder_and_duplicate_secrets(tmp_path):
    with pytest.raises(StartupError, match="at least 32"):
        validate_security_config(make_settings(tmp_path, jwt_secret="short"))
    with pytest.raises(StartupError, match="placeholder"):
        validate_security_config(make_settings(tmp_path, jwt_secret="changeme" + "x" * 30))
    with pytest.raises(StartupError, match="different"):
        validate_security_config(make_settings(tmp_path, secret_key=GOOD["jwt_secret"]))


def test_guard_checks_bootstrap_mode(tmp_path):
    with pytest.raises(StartupError, match="SUPERADMIN_BOOTSTRAP_MODE"):
        validate_security_config(make_settings(tmp_path, superadmin_bootstrap_mode="always"))
    with pytest.raises(StartupError, match="SUPERADMIN_USERNAME"):
        validate_security_config(make_settings(tmp_path, superadmin_bootstrap_mode="env"))
    with pytest.raises(StartupError, match="at least 12"):
        validate_security_config(
            make_settings(
                tmp_path,
                superadmin_bootstrap_mode="env",
                superadmin_username="root",
                superadmin_password="short",
            )
        )
    validate_security_config(
        make_settings(
            tmp_path,
            superadmin_bootstrap_mode="env",
            superadmin_username="root",
            superadmin_password="a-long-enough-password",
        )
    )


# ---- Step 2c / 3: media and runtime storage --------------------------------


def test_media_check_skipped_when_backend_none(tmp_path):
    settings = make_settings(tmp_path, media_storage_backend="none")
    assert check_media_storage(settings) is False
    assert not settings.media_dir.exists()


def test_media_check_and_runtime_storage_create_dirs(tmp_path):
    settings = make_settings(tmp_path)
    assert check_media_storage(settings) is True
    prepare_runtime_storage(settings)
    assert settings.media_dir.is_dir() and settings.static_dir.is_dir()


# ---- Full sequence with fakes ----------------------------------------------


class FakeAdmin:
    async def command(self, name):
        return {"ok": 1}


class FakeMongo:
    admin = FakeAdmin()

    def close(self):
        pass


class FakeRedis:
    async def ping(self):
        return True

    async def aclose(self):
        pass


@pytest.fixture
def calls(monkeypatch, tmp_path):
    order: list[str] = []
    settings = make_settings(tmp_path)

    async def connect_mongo(s):
        order.append("mongo")
        return FakeMongo(), object()

    async def check_tx(client, s):
        order.append("transactions")
        return True

    async def connect_redis(s):
        order.append("redis")
        return FakeRedis()

    def check_media(s):
        order.append("media")
        return True

    async def seeding(db, s):
        order.append("seeding")
        prepare_runtime_storage(s)

    async def recovery(db):
        order.append("recovery")
        return 0

    def guard(s):
        order.append("guard")
        validate_security_config(s)

    async def idle_loop(db, s):
        order.append("worker")
        import asyncio

        await asyncio.Event().wait()

    real_mount = startup.mount_api

    def mount(app, s):
        order.append("mount")
        real_mount(app, s)

    monkeypatch.setattr(startup, "validate_security_config", guard)
    monkeypatch.setattr(startup, "connect_mongo", connect_mongo)
    monkeypatch.setattr(startup, "check_transaction_support", check_tx)
    monkeypatch.setattr(startup, "connect_redis", connect_redis)
    monkeypatch.setattr(startup, "check_media_storage", check_media)
    monkeypatch.setattr(startup, "run_seeding", seeding)
    monkeypatch.setattr(startup, "recover_audio_tasks", recovery)
    monkeypatch.setattr(startup, "maintenance_loop", idle_loop)
    monkeypatch.setattr(startup, "cccd_retention_loop", idle_loop)

    real_start = WorkerManager.start

    def logged_start(self, name, factory):
        order.append(f"start:{name}")
        real_start(self, name, factory)

    monkeypatch.setattr(WorkerManager, "start", logged_start)

    class IdleAudioManager:
        def __init__(self, db, s, tts):
            pass

        async def run(self):
            order.append("audio-manager")
            import asyncio

            await asyncio.Event().wait()

    monkeypatch.setattr(startup, "AudioTaskManager", IdleAudioManager)
    monkeypatch.setattr(startup, "mount_api", mount)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    return order, settings


def test_startup_order_and_readiness(calls):
    order, settings = calls
    app = create_app()
    with TestClient(app) as client:
        assert order[:3] == ["guard", "mongo", "transactions"]
        assert order.index("redis") < order.index("media") < order.index("seeding")
        assert order.index("seeding") < order.index("recovery") < order.index("start:maintenance")
        assert order.index("start:maintenance") < order.index("start:audio_tasks") < order.index("mount")

        assert client.get("/health").json() == {"status": "ok"}
        body = client.get("/health/ready").json()
        assert client.get("/health/ready").status_code == 200
        assert body["status"] == "ready"
        assert all(body["checks"].values())

        (settings.static_dir / "hello.txt").write_text("hi")
        assert client.get("/static/hello.txt").text == "hi"

        # app.openapi() lists every mounted path in all FastAPI versions
        # (newer ones keep included routers nested, so app.routes has no flat `.path`).
        paths = set(app.openapi()["paths"])
        for expected in (
            "/health",
            "/poi/load-all",
            "/poi/nearby",
            "/pois",
            "/audio/tts",
            "/audio/pack-manifest",
            "/admin/auth/login",
            "/admin/audio-tasks/stream",
            "/localizations/prepare-hotset",
            "/localizations/on-demand",
            "/localizations/warmup",
            "/api/v1/ui-bundles/{locale}",
        ):
            assert expected in paths, expected


def test_ten_routers_registered():
    # `content` and `localization` have no common prefix (their paths are full), so the
    # routers are told apart by their tag, not by prefix.
    tags = {tag for r in ROUTERS for tag in r.tags}
    assert len(ROUTERS) == 11 and len(tags) == 11


def test_not_ready_when_redis_down(calls):
    order, _ = calls
    app = create_app()
    with TestClient(app) as client:

        async def broken():
            raise ConnectionError("down")

        app.state.redis.ping = broken
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json()["checks"]["redis"] is False


def test_startup_failure_never_becomes_ready(calls, monkeypatch):
    order, settings = calls

    async def boom(db):
        raise RuntimeError("recovery failed")

    monkeypatch.setattr(startup, "recover_audio_tasks", boom)
    app = create_app()
    with pytest.raises(RuntimeError, match="recovery failed"):
        with TestClient(app):
            pass
    assert app.state.ready is False
    assert "mount" not in order


def test_guard_failure_stops_before_any_connection(calls, monkeypatch, tmp_path):
    order, _ = calls
    bad = make_settings(tmp_path, jwt_secret="")
    monkeypatch.setattr("app.main.get_settings", lambda: bad)
    app = create_app()
    with pytest.raises(StartupError):
        with TestClient(app):
            pass
    assert order == ["guard"]
