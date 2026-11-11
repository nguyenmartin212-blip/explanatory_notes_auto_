// Who is calling and what they may do. Pure logic: no web framework, no database.
import { WILDCARD } from './permissions.js';
import { PermissionDenied } from '../core/errors.js';

export class AuthContext {
  constructor(user, role, permissions) {
    this.user = user;
    this.role = role; // null if the user's role no longer exists
    this.permissions = permissions; // Set<string>
  }

  get userId() { return this.user.user_id; }
  get roleName() { return this.user.role ?? null; }

  hasPermission(permission) {
    return this.permissions.has(WILDCARD) || this.permissions.has(permission);
  }
}

export function buildContext(user, role) {
  return new AuthContext(user, role, new Set((role || {}).permissions || []));
}

/** Bearer header first (API clients), then the httpOnly cookie (browsers). */
export function extractToken(authorization, cookieValue) {
  if (authorization) {
    const trimmed = String(authorization).trim();
    const idx = trimmed.indexOf(' ');
    const scheme = idx === -1 ? trimmed : trimmed.slice(0, idx);
    const value = idx === -1 ? '' : trimmed.slice(idx + 1);
    if (scheme.toLowerCase() === 'bearer' && value.trim()) return value.trim();
  }
  return cookieValue || null;
}

/** Allow only if the role has every required permission. */
export function authorize(ctx, required) {
  const needed = [...required];
  if (ctx.role === null || ctx.role === undefined) {
    throw new PermissionDenied('forbidden', "The account's role no longer exists");
  }
  const missing = needed.filter((p) => !ctx.hasPermission(p));
  if (missing.length) throw new PermissionDenied('forbidden', `Missing permission(s): ${missing.join(', ')}`, missing);
}

