// Express middleware: authentication and the permission guard.
//   router.delete('/pois/:id', requirePermission('poi:delete'), wrap(async (req, res) => { req.auth ... }))
import { ACCESS_COOKIE_NAME } from './constants.js';
import { authorize, extractToken } from './context.js';
import { parseCookies } from './cookies.js';
import { AuthenticationError } from '../core/errors.js';
import * as authService from '../services/authService.js';

/** Bearer header first, then the httpOnly cookie. */
export async function getAuthContext(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = extractToken(req.headers.authorization, cookies[ACCESS_COOKIE_NAME]);
  if (!token) throw new AuthenticationError('not_authenticated', 'Authentication required');
  const { db, redis } = req.app.locals.state;
  return authService.authenticate(db, redis, req.app.locals.settings, token);
}

/** The caller must hold every listed permission. Sets `req.auth`. */
export function requirePermission(...permissions) {
  if (!permissions.length) throw new Error('requirePermission needs at least one permission');
  return (req, res, next) => {
    getAuthContext(req)
      .then((ctx) => {
        authorize(ctx, permissions);
        req.auth = ctx;
        next();
      })
      .catch(next);
  };
}

/** Authenticated only (no permission check). Sets `req.auth`. */
export function requireAuth(req, res, next) {
  getAuthContext(req).then((ctx) => { req.auth = ctx; next(); }).catch(next);
}
