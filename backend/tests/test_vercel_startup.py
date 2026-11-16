import os
from pathlib import Path
import subprocess
import sys
from textwrap import dedent


def test_vercel_starts_with_read_only_code_and_no_database(tmp_path):
    script = dedent("""\
        import errno
        from pathlib import Path

        app_dir = (Path.cwd() / "app").resolve()
        mkdir = Path.mkdir

        def read_only_bundle(path, *args, **kwargs):
            if path.is_relative_to(app_dir):
                raise OSError(errno.EROFS, "Read-only file system", str(path))
            return mkdir(path, *args, **kwargs)

        Path.mkdir = read_only_bundle

        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.tts_service import AUDIO_DIR

        assert not AUDIO_DIR.is_relative_to(app_dir)
        (AUDIO_DIR / "test.mp3").write_bytes(b"test audio")

        with TestClient(app) as client:
            root = client.get("/", follow_redirects=False)
            assert root.headers["location"] == "/docs"
            assert client.get("/docs").status_code == 200
            assert client.get("/health").json() == {"status": "ok"}
            assert client.get("/health/ready").status_code == 503
            assert client.get("/api/v1/pois").status_code == 503
            assert client.get("/static/audio/test.mp3").content == b"test audio"
        """)
    environment = {
        **os.environ,
        "VERCEL": "1",
        "DATABASE_URL": "",
        "DB_HOST": "127.0.0.1",
        "TMPDIR": str(tmp_path),
        "TEMP": str(tmp_path),
        "TMP": str(tmp_path),
    }
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
