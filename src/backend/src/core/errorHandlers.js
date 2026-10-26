// Map domain errors to HTTP responses (Express error middleware). Body shapes follow the FastAPI version:
// `{ detail, code? }`.
import { PasswordPolicyError } from '../auth/passwords.js';
import {
  AuthenticationError, ConflictError, HttpError, NotFoundError, NotReadyError, PermissionDenied, RateLimited,
  TtsError, ValidationError,
} from './errors.js';
import { logger } from './logger.js';

/** Turn a thrown error into { status, body, headers }. Exported for tests. */
export function describeError(err) {
  if (err instanceof RateLimited) {
    return {
      status: 429,
      body: { detail: err.message, code: 'rate_limited', retry_after: err.retryAfter },
      headers: { 'Retry-After': String(err.retryAfter) },
    };
  }
  if (err instanceof AuthenticationError) {
    if (err.code === 'auth_unavailable') return { status: 503, body: { detail: err.message, code: err.code }, headers: {} }; // fail closed
    return { status: 401, body: { detail: err.message, code: err.code }, headers: { 'WWW-Authenticate': 'Bearer' } };
  }
  if (err instanceof PermissionDenied) {
    const body = { detail: err.message, code: err.code };
    if (err.missing.length) body.missing = [...err.missing];
    return { status: 403, body, headers: {} };
  }
  if (err instanceof HttpError) return { status: err.status, body: { detail: err.detail }, headers: err.headers };
  if (err instanceof ValidationError) return { status: 422, body: { detail: err.errors }, headers: {} };
  if (err instanceof NotFoundError) return { status: 404, body: { detail: err.message }, headers: {} };
  if (err instanceof NotReadyError) return { status: 409, body: { detail: err.message, report: err.report }, headers: {} };
  if (err instanceof ConflictError) return { status: 409, body: { detail: err.message }, headers: {} };
  if (err instanceof TtsError) return { status: 502, body: { detail: err.message }, headers: {} };
  if (err instanceof RangeError || err instanceof PasswordPolicyError) {
    return { status: 422, body: { detail: err.message }, headers: {} };
  }
  if (err && err.type === 'entity.parse.failed') return { status: 422, body: { detail: 'JSON decode error' }, headers: {} };
  if (err && err.type === 'entity.too.large') return { status: 413, body: { detail: 'Request body too large' }, headers: {} };
  return null;
}

export function errorMiddleware(err, req, res, next) { 
  const described = describeError(err);
  if (!described) {
    logger.exception(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return res.end();
    return res.status(500).json({ detail: 'Internal Server Error' });
  }
  if (res.headersSent) return res.end();
  for (const [k, v] of Object.entries(described.headers)) res.set(k, v);
  return res.status(described.status).json(described.body);
}

export function notFoundMiddleware(req, res) {
  res.status(404).json({ detail: 'Not Found' });
}
