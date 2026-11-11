// Small Express helpers shared by the routers.
import { HttpError, ValidationError } from './errors.js';

/** Express 4 does not catch rejected promises: forward them to the error middleware. */
export const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const clientOf = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

export const stateOf = (req) => req.app.locals.state;
export const settingsOf = (req) => req.app.locals.settings;

/** Absolute base URL (always ends with "/"). */
export function baseUrlOf(req, settings) {
  if (settings.publicBaseUrl) return settings.publicBaseUrl;
  return `${req.protocol}://${req.get('host')}/`;
}

// ---- Query-string validation (422 like FastAPI's Query constraints) ------------------------------
const fail = (name, msg) => { throw new ValidationError([{ loc: ['query', name], msg }]); };

export function queryNumber(req, name, { def, min = -Infinity, max = Infinity, integer = false, required = false } = {}) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') {
    if (required) fail(name, 'Field required');
    return def;
  }
  if (typeof raw !== 'string') return fail(name, 'Input should be a valid number');
  const n = Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
    return fail(name, integer ? 'Input should be a valid integer' : 'Input should be a valid number');
  }
  if (n < min) fail(name, `Input should be greater than or equal to ${min}`);
  if (n > max) fail(name, `Input should be less than or equal to ${max}`);
  return n;
}

export function queryEnum(req, name, allowed, { def = null } = {}) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') return def;
  if (typeof raw !== 'string' || !allowed.includes(raw)) fail(name, `Input should be ${allowed.map((a) => `'${a}'`).join(', ')}`);
  return raw;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i;

/** ISO 8601 datetime; a value without a timezone is read as UTC. */
export function queryDatetime(req, name) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !ISO_RE.test(raw.trim())) return fail(name, 'Input should be a valid datetime');
  let text = raw.trim().replace(' ', 'T');
  if (!text.includes('T')) text += 'T00:00:00';
  if (!/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(text)) text += 'Z';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return fail(name, 'Input should be a valid datetime');
  return date;
}

export function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

export { HttpError };
