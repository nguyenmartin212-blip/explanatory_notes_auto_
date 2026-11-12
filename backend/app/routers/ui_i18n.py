from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from app.core.config import get_settings
from app.services import ui_bundle_service
from app.services.poi_sync import etag_matches

router = APIRouter(prefix="/api/v1/ui-bundles", tags=["ui_i18n"])


@router.get("/{locale}")
async def get_ui_bundle(request: Request, locale: str, if_none_match: str | None = Header(default=None)):
    """Namespace `public-ui`. en/vi/zh/ja/ko are static; any other locale returns the
    English fallback with `status: "pending"` (+ `source_hash`) while it is translated."""
    state = request.app.state
    client = request.client.host if request.client else "unknown"
    try:
        body, retry_after = await ui_bundle_service.get_bundle(
            state.db, state.redis, get_settings(), state.localization, locale, client=client
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    headers = {"Cache-Control": "no-cache"}
    if retry_after:
        headers["Retry-After"] = str(retry_after)
    if body["status"] == "ready":
        etag = ui_bundle_service.make_etag(body["namespace"], body["locale"], "ready", body["source_hash"])
        headers["ETag"] = etag
        if etag_matches(if_none_match, etag):
            return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)
