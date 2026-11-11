// Domain errors (same meaning as the Python version). HTTP mapping lives in errorHandlers.js.

/** Invalid input value (Python ValueError): mapped to HTTP 422. */
export class ValueError extends Error {
  constructor(message) { super(message); this.name = 'ValueError'; }
}

export class StartupError extends Error {
  constructor(message) { super(message); this.name = 'StartupError'; }
}

/** The requested entity does not exist -> 404. */
export class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; }
}

/** The operation conflicts with existing data (e.g. duplicate id) -> 409. */
export class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; }
}

/** A POI cannot be activated yet; `report` explains what is missing -> 409. */
export class NotReadyError extends Error {
  constructor(report) {
    super('POI is not ready to be activated: ' + (report.missing || []).join(', '));
    this.name = 'NotReadyError';
    this.report = report;
  }
}

/**
 * The caller is not (validly) authenticated -> 401.
 * code: not_authenticated | invalid_token | token_expired | invalid_credentials | account_disabled
 *       | auth_unavailable (token revocation list unreachable -> 503, fail closed)
 */
export class AuthenticationError extends Error {
  constructor(code = 'not_authenticated', message = null) {
    super(message || code);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

/** The caller is authenticated but not allowed -> 403. code: forbidden */
export class PermissionDenied extends Error {
  constructor(code = 'forbidden', message = null, missing = []) {
    super(message || code);
    this.name = 'PermissionDenied';
    this.code = code;
    this.missing = [...missing];
  }
}

/** Translation or speech synthesis failed (or its library is not installed). */
export class TtsError extends Error {
  constructor(message) { super(message); this.name = 'TtsError'; }
}

/** The MongoDB $geoNear query failed (e.g. missing 2dsphere index). */
export class GeoQueryUnavailable extends Error {
  constructor(message) { super(message); this.name = 'GeoQueryUnavailable'; }
}

/** A limiter blocked the request -> 429 with a Retry-After header (seconds). */
export class RateLimited extends Error {
  constructor(retryAfter, message = null) {
    super(message || `Too many requests; retry after ${Math.max(Math.trunc(retryAfter), 1)}s`);
    this.name = 'RateLimited';
    this.retryAfter = Math.max(Math.trunc(retryAfter), 1);
  }
}

/** Request body/query failed validation -> 422 (same status FastAPI used). */
export class ValidationError extends ValueError {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [{ loc: [], msg: String(errors) }];
    super(list.map((e) => `${(e.loc || []).join('.')}: ${e.msg}`).join('; '));
    this.name = 'ValidationError';
    this.errors = list;
  }
}

/** Plain HTTP error with FastAPI's `{ detail }` body shape. */
export class HttpError extends Error {
  constructor(status, detail, headers = {}) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
    this.headers = headers;
  }
}
