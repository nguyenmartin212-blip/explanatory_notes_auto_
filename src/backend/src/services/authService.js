// Login, token refresh/rotation, logout and request authentication.
// - Passwords are verified with bcrypt (see auth/passwords.js). An unknown username costs the same time as
//   a wrong password and gives the same error.
// - A token is valid only if: signature/expiry/type are valid, its jti is not on the revocation list
//   (Redis), the user still exists and is active, and the token's `ver` equals the user's `token_version`.
// - Refresh tokens are single use (rotation): using one revokes it atomically.
// - If the revocation list (Redis) cannot be reached the request is refused (fail closed, HTTP 503): a
//   logged-out token must never be accepted by accident.
import { ACCESS_TOKEN_MINUTES, JWT_LEEWAY_SECONDS, REFRESH_TOKEN_DAYS } from '../auth/constants.js';
import { buildContext } from '../auth/context.js';
import { defaultHasher } from '../auth/passwords.js';
import { WILDCARD } from '../auth/permissions.js';
import { ACCESS, REFRESH, createSessionTokens, decodeToken } from '../auth/tokens.js';
import { AuthenticationError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { adminUserStore, roleStore } from '../stores/index.js';

export const REVOKED_PREFIX = 'auth:revoked:';

// ---- Revocation list (Redis) ----
function ttlSeconds(claims, now) {
  return Math.max(Math.trunc((claims.expiresAt - now) / 1000), 0) + JWT_LEEWAY_SECONDS + 1;
}

async function isRevoked(redis, jti) {
  try {
    return Boolean(await redis.exists(REVOKED_PREFIX + jti));
  } catch (err) {
    logger.error(`Cannot read the token revocation list: ${err.message}`);
    throw new AuthenticationError('auth_unavailable', 'Authentication is temporarily unavailable');
  }
}

/** Returns false if the token already was revoked (atomic SET NX), so concurrent uses cannot both win. */
async function revoke(redis, claims, now) {
  try {
    const done = await redis.set(REVOKED_PREFIX + claims.jti, '1', { EX: ttlSeconds(claims, now), NX: true });
    return Boolean(done);
  } catch (err) {
    logger.error(`Cannot write the token revocation list: ${err.message}`);
    throw new AuthenticationError('auth_unavailable', 'Authentication is temporarily unavailable');
  }
}

function checkUser(user, claims) {
  if (!user || claims.tokenVersion !== (user.token_version ?? 0)) throw new AuthenticationError('invalid_token');
  if (!user.is_active) throw new AuthenticationError('account_disabled');
  return user;
}

// ---- Flows ----
export async function login(db, settings, username, password, { hasher = defaultHasher, now = new Date() } = {}) {
  const name = (username || '').trim().toLowerCase();
  const user = name ? await adminUserStore.getByUsername(db, name) : null;

  if (!user) {
    await hasher.dummyVerify(password || '');
    throw new AuthenticationError('invalid_credentials', 'Wrong username or password');
  }
  if (!(await hasher.verify(password || '', user.password_hash))) {
    throw new AuthenticationError('invalid_credentials', 'Wrong username or password');
  }
  if (!user.is_active) throw new AuthenticationError('account_disabled', 'This account is disabled');

  await adminUserStore.recordLogin(db, user.user_id, now);
  const session = createSessionTokens(settings, { userId: user.user_id, tokenVersion: user.token_version ?? 0, now });
  return { user, session };
}

/** Exchange a refresh token for a new access + refresh pair (rotation). */
export async function refreshSession(db, redis, settings, refreshToken, { now = new Date() } = {}) {
  const claims = decodeToken(settings, refreshToken, REFRESH, { now });
  if (await isRevoked(redis, claims.jti)) throw new AuthenticationError('invalid_token');
  const user = checkUser(await adminUserStore.getById(db, claims.userId), claims);

  if (!(await revoke(redis, claims, now))) throw new AuthenticationError('invalid_token'); // lost a race
  const session = createSessionTokens(settings, { userId: user.user_id, tokenVersion: user.token_version ?? 0, now });
  return { user, session };
}

/** Revoke the given tokens. Invalid or expired tokens are ignored. Returns how many were revoked. */
export async function logout(redis, settings, { accessToken = null, refreshToken = null, now = new Date() } = {}) {
  let revoked = 0;
  for (const [token, type] of [[accessToken, ACCESS], [refreshToken, REFRESH]]) {
    if (!token) continue;
    let claims;
    try {
      claims = decodeToken(settings, token, type, { now });
    } catch (err) {
      if (err instanceof AuthenticationError) continue;
      throw err;
    }
    if (await revoke(redis, claims, now)) revoked += 1;
  }
  return revoked;
}

/** Invalidate every token the user holds (e.g. password change, account takeover). */
export async function revokeAllSessions(db, userId) {
  return (await adminUserStore.bumpTokenVersion(db, userId)) !== null;
}

/** Resolve an access token to a user + role. Throws AuthenticationError. */
export async function authenticate(db, redis, settings, token, { now = new Date() } = {}) {
  const claims = decodeToken(settings, token, ACCESS, { now });
  if (await isRevoked(redis, claims.jti)) throw new AuthenticationError('invalid_token');
  const user = checkUser(await adminUserStore.getById(db, claims.userId), claims);
  const role = await roleStore.get(db, user.role);
  return buildContext(user, role);
}

// ---- Views ----
/** What the caller can really use ('*' for the wildcard role). */
export function effectivePermissions(ctx) {
  if (ctx.role === null || ctx.role === undefined) return [];
  return ctx.permissions.has(WILDCARD) ? [WILDCARD] : [...ctx.permissions].sort();
}

/** Safe public view of the caller: never includes the password hash . */
export function userView(ctx) {
  const { user } = ctx;
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email ?? null,
    role: user.role ?? null,
    is_active: Boolean(user.is_active),
    permissions: effectivePermissions(ctx),
  };
}

/** Body for Bearer-header clients (browsers use the httpOnly cookies set alongside). */
export function tokenResponse(session) {
  return {
    token_type: 'bearer',
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: ACCESS_TOKEN_MINUTES * 60,
    refresh_expires_in: REFRESH_TOKEN_DAYS * 24 * 3600,
  };
}
