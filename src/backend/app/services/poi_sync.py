"""GET /poi/load-all: full sync and delta sync.

Version token: `dataset_version` (monotonic counter of public changes).
ETag:          W/"<dataset_version>-<lang|all>"  (used with If-None-Match)
sync_cursor:   opaque token holding the dataset_version the client is at.

Delta sync is chosen when the client sends a usable `sync_cursor` (or
`updated_after`) and `sync_mode` is not 'full'. Otherwise, or when the cursor
is invalid or newer than the server (e.g. database reset), the answer is a
full sync, and the response's `sync_mode` tells the client which one it got.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

from app.services.poi_payload import build_client_poi, build_poi_payload, iso
from app.stores import poi_dataset_store, poi_localization_store, poi_store

CURSOR_FORMAT = 1


def encode_cursor(version: int) -> str:
    raw = json.dumps({"c": CURSOR_FORMAT, "v": version}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(token: str | None) -> int | None:
    """Return the dataset_version inside a cursor, or None if invalid."""
    if not token:
        return None
    try:
        padded = token + "=" * (-len(token) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        version = data["v"]
        if data.get("c") == CURSOR_FORMAT and isinstance(version, int) and version >= 0:
            return version
    except (ValueError, KeyError, TypeError):
        pass
    return None


def make_etag(version: int, lang: str | None) -> str:
    return f'W/"{version}-{lang or "all"}"'


def _normalize_etag(tag: str) -> str:
    tag = tag.strip()
    if tag.startswith("W/"):
        tag = tag[2:]
    return tag.strip('"')


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    target = _normalize_etag(etag)
    for part in if_none_match.split(","):
        part = part.strip()
        if part == "*" or _normalize_etag(part) == target:
            return True
    return False


async def get_dataset_version(db) -> int:
    return await poi_dataset_store.get_version(db)


async def load_all(
    db,
    *,
    lang: str | None = None,
    sync_mode: str = "auto",
    sync_cursor: str | None = None,
    updated_after: datetime | None = None,
) -> dict:
    # Read the version BEFORE the data: anything changing in between is simply
    # re-sent by the next delta (idempotent for clients).
    version = await poi_dataset_store.get_version(db)

    cursor_version = decode_cursor(sync_cursor)
    if cursor_version is not None and cursor_version > version:
        cursor_version = None  # cursor from the future: server was reset -> full sync

    mode = "full"
    if sync_mode != "full":
        if cursor_version is not None:
            mode = "delta"
        elif updated_after is not None:
            mode = "delta"

    removed: list[str] = []
    if mode == "full":
        pois = await poi_store.list_active(db)
    elif cursor_version is not None:
        pois = await poi_store.list_active_since_version(db, cursor_version)
        removed = await poi_dataset_store.tombstone_ids_since_version(db, cursor_version)
    else:
        if updated_after.tzinfo is None:
            updated_after = updated_after.replace(tzinfo=timezone.utc)
        pois = await poi_store.list_active_updated_after(db, updated_after)
        removed = await poi_dataset_store.tombstone_ids_deleted_after(db, updated_after)

    pois.sort(key=lambda p: p["poi_id"])
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p in pois])
    present = {p["poi_id"] for p in pois}

    return {
        "dataset_version": version,
        "sync_mode": mode,
        "sync_cursor": encode_cursor(version),
        "generated_at": iso(datetime.now(timezone.utc)),
        "count": len(pois),
        "pois": [build_poi_payload(p, locs.get(p["poi_id"], {}), lang) for p in pois],
        # An id that was deleted and re-created appears in `pois`, not as removed.
        "removed_poi_ids": sorted(set(removed) - present),
    }


async def load_client_pois(db, base_url: str) -> list[dict]:
    """Public POIs in the FE `Poi` shape, ordered like the FE offline store: priority desc, id asc."""
    pois = await poi_store.list_active(db)
    pois.sort(key=lambda p: (-p.get("priority", 0), p["poi_id"]))
    locs = await poi_localization_store.list_for_pois(db, [p["poi_id"] for p in pois])
    return [build_client_poi(p, locs.get(p["poi_id"], {}), base_url) for p in pois]
