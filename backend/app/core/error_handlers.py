"""Map auth errors to HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.auth.passwords import PasswordPolicyError
from app.core.errors import AuthenticationError, ConflictError, NotFoundError, NotReadyError, PermissionDenied, RateLimited


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


async def _not_found(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=404)


async def _conflict(request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=409)


async def _not_ready(request: Request, exc: NotReadyError) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "readiness": exc.report}, status_code=409)


async def _password_policy(request: Request, exc: PasswordPolicyError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=422)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(NotFoundError, _not_found)
    app.add_exception_handler(ConflictError, _conflict)
    app.add_exception_handler(NotReadyError, _not_ready)
    app.add_exception_handler(PasswordPolicyError, _password_policy)
    app.add_exception_handler(RateLimited, _rate_limited)
    app.add_exception_handler(AuthenticationError, _authentication_error)
    app.add_exception_handler(PermissionDenied, _permission_denied)
