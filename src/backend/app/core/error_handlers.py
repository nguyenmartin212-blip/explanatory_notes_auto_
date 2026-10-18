"""Map auth errors to HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.errors import AuthenticationError, PermissionDenied, RateLimited


async def _authentication_error(request: Request, exc: AuthenticationError) -> JSONResponse:
    if exc.code == "auth_unavailable":  # revocation list unreachable: fail closed
        return JSONResponse({"detail": str(exc), "code": exc.code}, status_code=503)
    return JSONResponse(
        {"detail": str(exc), "code": exc.code},
        status_code=401,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _permission_denied(request: Request, exc: PermissionDenied) -> JSONResponse:
    body = {"detail": str(exc), "code": exc.code}
    if exc.missing:
        body["missing"] = list(exc.missing)
    return JSONResponse(body, status_code=403)


async def _rate_limited(request: Request, exc: RateLimited) -> JSONResponse:
    return JSONResponse(
        {"detail": str(exc), "code": "rate_limited", "retry_after": exc.retry_after},
        status_code=429,
        headers={"Retry-After": str(exc.retry_after)},
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RateLimited, _rate_limited)
    app.add_exception_handler(AuthenticationError, _authentication_error)
    app.add_exception_handler(PermissionDenied, _permission_denied)
