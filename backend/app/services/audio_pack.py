"""GET /audio/pack-manifest: the list of audio files an app can download offline.

Only audio of public (active) POIs that is ready and matches the current text is
listed. `pack_version` is content-addressed: the first 16 hex chars of the SHA-256
of the sorted "path:sha256" lines, so it changes if and only if a file changes,
is added or is removed.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from app.services.localization_fallback import has_valid_audio
from app.services.poi_payload import iso
from app.stores import poi_dataset_store, poi_localization_store, poi_store


def make_pack_etag(pack_version: str) -> str:
    return f'W/"pack-{pack_version}"'


def compute_pack_version(files: list[dict]) -> str:
    lines = "\n".join(sorted(f"{f['path']}:{f['sha256']}" for f in files))
    return hashlib.sha256(lines.encode("utf-8")).hexdigest()[:16]


async def build_manifest(db, *, lang: str | None = None) -> dict:
    dataset_version = await poi_dataset_store.get_version(db)
    pois = sorted(await poi_store.list_active(db), key=lambda p: p["poi_id"])
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p in pois])

    files: list[dict] = []
    for poi in pois:
        for language, loc in sorted(locs.get(poi["poi_id"], {}).items()):
            if lang and language != lang:
                continue
            if not (has_valid_audio(loc) and loc.get("audio_path") and loc.get("audio_sha256")):
                continue
            files.append(
                {
                    "poi_id": poi["poi_id"],
                    "language": language,
                    "url": loc["audio_url"],
                    "path": loc["audio_path"],
                    "size": loc.get("audio_size"),
                    "sha256": loc["audio_sha256"],
                }
            )

    return {
        "pack_version": compute_pack_version(files),
        "dataset_version": dataset_version,
        "language": lang,
        "generated_at": iso(datetime.now(timezone.utc)),
        "count": len(files),
        "total_bytes": sum(f["size"] or 0 for f in files),
        "files": files,
    }
