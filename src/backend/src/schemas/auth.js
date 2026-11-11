// Request models for authentication.
import { Collector, requireBody, str } from './validate.js';

export function parseLogin(body) {
  requireBody(body);
  const c = new Collector();
  const out = { username: undefined, password: undefined };
  if (!('username' in body)) c.add('username', 'Field required');
  else out.username = str(c, 'username', body.username, { min: 1, max: 100, strip: true });
  if (!('password' in body)) c.add('password', 'Field required');
  else out.password = str(c, 'password', body.password, { min: 1, max: 256, strip: true });
  c.throwIfAny();
  return out;
}

/** Optional body for Bearer clients; browsers send the refresh cookie instead. */
export function parseRefresh(body) {
  const c = new Collector();
  const out = { refresh_token: null };
  if (body && typeof body === 'object' && body.refresh_token !== undefined && body.refresh_token !== null) {
    out.refresh_token = str(c, 'refresh_token', body.refresh_token);
  }
  c.throwIfAny();
  return out;
}
