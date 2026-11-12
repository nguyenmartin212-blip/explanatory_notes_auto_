class StartupError(RuntimeError):
    """Raised when a startup step fails; the app must not become ready."""


class NotFoundError(LookupError):
    """The requested entity does not exist."""


class ConflictError(RuntimeError):
    """The operation conflicts with existing data (e.g. duplicate id)."""


class NotReadyError(RuntimeError):
    """A POI cannot be activated yet; `report` explains what is missing."""

    def __init__(self, report: dict):
        super().__init__("POI is not ready to be activated: " + ", ".join(report.get("missing", [])))
        self.report = report


class AuthenticationError(RuntimeError):
    """The caller is not (validly) authenticated -> HTTP 401.

    `code`: not_authenticated | invalid_token | token_expired | invalid_credentials | account_disabled
    | auth_unavailable (token revocation list unreachable -> HTTP 503, fail closed)
    """

    def __init__(self, code: str = "not_authenticated", message: str | None = None):
        super().__init__(message or code)
        self.code = code


class PermissionDenied(RuntimeError):
    """The caller is authenticated but not allowed -> HTTP 403.

    `code`: forbidden | owner_not_verified | not_an_owner
    """

    def __init__(self, code: str = "forbidden", message: str | None = None, missing: tuple = ()):
        super().__init__(message or code)
        self.code = code
        self.missing = tuple(missing)


class TtsError(RuntimeError):
    """Translation or speech synthesis failed (or its library is not installed)."""


class GeoQueryUnavailable(RuntimeError):
    """The MongoDB $geoNear query failed (e.g. missing 2dsphere index)."""


class RateLimited(RuntimeError):
    """A limiter blocked the request -> HTTP 429 with a Retry-After header (seconds)."""

    def __init__(self, retry_after: int, message: str | None = None):
        super().__init__(message or f"Too many requests; retry after {retry_after}s")
        self.retry_after = max(int(retry_after), 1)
