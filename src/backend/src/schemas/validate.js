// Tiny request validation helpers (replace the Pydantic models). Failures throw ValidationError (HTTP 422).
import { ValidationError } from '../core/errors.js';

export class Collector {
  constructor() { this.errors = []; }
  add(loc, msg) { this.errors.push({ loc: Array.isArray(loc) ? loc : [loc], msg }); }
  throwIfAny() { if (this.errors.length) throw new ValidationError(this.errors); }
}

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Returns the (optionally stripped) string, or undefined after recording an error. */
export function str(c, loc, value, { min = 0, max = Infinity, strip = false, pattern = null } = {}) {
  if (typeof value !== 'string') { c.add(loc, 'Input should be a valid string'); return undefined; }
  const v = strip ? value.trim() : value;
  if ([...v].length < min) { c.add(loc, `String should have at least ${min} characters`); return undefined; }
  if ([...v].length > max) { c.add(loc, `String should have at most ${max} characters`); return undefined; }
  if (pattern && !pattern.test(v)) { c.add(loc, `String should match pattern '${pattern.source}'`); return undefined; }
  return v;
}

export function num(c, loc, value, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) { c.add(loc, 'Input should be a valid number'); return undefined; }
  if (integer && !Number.isInteger(value)) { c.add(loc, 'Input should be a valid integer'); return undefined; }
  if (value < min) { c.add(loc, `Input should be greater than or equal to ${min}`); return undefined; }
  if (value > max) { c.add(loc, `Input should be less than or equal to ${max}`); return undefined; }
  return value;
}

export function strList(c, loc, value, { max = Infinity } = {}) {
  if (!Array.isArray(value)) { c.add(loc, 'Input should be a valid list'); return undefined; }
  if (value.length > max) { c.add(loc, `List should have at most ${max} items`); return undefined; }
  const out = [];
  value.forEach((item, i) => {
    if (typeof item !== 'string') c.add([...[].concat(loc), i], 'Input should be a valid string');
    else out.push(item);
  });
  return out;
}

export function requireBody(body) {
  if (!isObject(body)) throw new ValidationError([{ loc: ['body'], msg: 'Input should be a valid object' }]);
  return body;
}
