from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.core.config import get_settings
from app.core.errors import TtsError
from app.schemas.audio import TtsRequest
from app.services import audio_pack
from app.services.poi_sync import etag_matches

router = APIRouter(prefix="/audio", tags=["audio"])

CHUNK_BYTES = 64 * 1024


def _iter_file(path: Path) -> Iterator[bytes]:
    with open(path, "rb") as handle:
        while chunk := handle.read(CHUNK_BYTES):
            yield chunk


@router.post("/tts")
async def tts(request: Request, body: TtsRequest):
    """Create (or reuse from cache) the MP3 for `text` in `lang` and stream it.

    The text is translated first when `source_lang` differs from `lang`.
    """
    max_chars = get_settings().tts_max_text_chars
    if len(body.text) > max_chars:
        raise HTTPException(status_code=422, detail=f"text is longer than {max_chars} characters")
    try:
        result = await request.app.state.tts.generate(body.text, body.lang, body.source_lang)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TtsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return StreamingResponse(
        _iter_file(result.cache_path),
        media_type="audio/mpeg",
        headers={
            "Content-Length": str(result.cache_path.stat().st_size),
            "X-Audio-Cache": "hit" if result.cache_hit else "miss",
            "X-Audio-Cache-Key": result.cache_key,
        },
    )


@router.get("/pack-manifest")
async def pack_manifest(
    request: Request,
    lang: str | None = Query(default=None, pattern="^(vi|en|zh|ja|ko)$"),
    if_none_match: str | None = Header(default=None),
):
    """Audio files of public POIs: url, size, SHA-256 and the pack version."""
    manifest = await audio_pack.build_manifest(request.app.state.db, lang=lang)
    etag = audio_pack.make_pack_etag(manifest["pack_version"])
    if etag_matches(if_none_match, etag):
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})
    return JSONResponse(manifest, headers={"ETag": etag, "Cache-Control": "no-cache"})
