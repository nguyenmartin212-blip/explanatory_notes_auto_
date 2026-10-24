// JWT access / refresh tokens (HS256, implemented with node:crypto).
// - access token:  30 minutes, signed with JWT_SECRET
// - refresh token: 7 days,     signed with REFRESH_TOKEN_SECRET (a different key)
// A token carries only the user id, its type and the user's `token_version`. Role and permissions are read
// from MongoDB on every request, so changes apply immediately. Bumping `token_version` (e.g. password
// change) invalidates every token issued before.
import crypto from 'node:crypto';
import {
  ACCESS_TOKEN_MINUTES, JWT_ALGORITHM, JWT_ISSUER, JWT_LEEWAY_SECONDS, REFRESH_TOKEN_DAYS,
} from './constants.js';
import { AuthenticationError, StartupError } from '../core/errors.js';
import { logger } from '../core/logger.js';

export const ACCESS = 'access';
export const REFRESH = 'refresh';
export const LIFETIMES_MS = {
  [ACCESS]: ACCESS_TOKEN_MINUTES * 60 * 1000,
  [REFRESH]: REFRESH_TOKEN_DAYS * 24 * 3600 * 1000,
};
const REQUIRED_CLAIMS = ['exp', 'iat', 'sub', 'jti', 'typ', 'ver'];
const devSecrets = new Map();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest();

function signingSecret(settings, tokenType) {
  const value = tokenType === ACCESS ? settings.jwtSecret : settings.refreshTokenSecret;
  if (value) return value;
  if (settings.isDevelopment) {
    // Development convenience only: a random per-process secret (tokens die on restart).
    if (!devSecrets.has(tokenType)) {
      logger.warn(`No ${tokenType} secret configured: using a random development secret`);
      devSecrets.set(tokenType, crypto.randomBytes(48).toString('base64url'));
    }
    return devSecrets.get(tokenType);
  }
  throw new StartupError(`Signing secret for ${tokenType} tokens is not configured`);
}

/** Encode a JWT (HS256). Exposed for tests. */
export function encodeJwt(payload, secret) {
  const head = b64u(JSON.stringify({ alg: JWT_ALGORITHM, typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(sign(`${head}.${body}`, secret))}`;
}

class JwtError extends Error {}
class JwtExpired extends JwtError {}

function decodeJwt(token, secret, { issuer, leewaySeconds, nowSeconds }) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new JwtError('malformed');
  const [head, body, signature] = parts;
  let header;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  } catch {
    throw new JwtError('bad header');
  }
  // never trust the token's own "alg": only HS256 is accepted ("none" and others are rejected)
  if (!header || header.alg !== JWT_ALGORITHM) throw new JwtError('algorithm not allowed');
  const expected = sign(`${head}.${body}`, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new JwtError('bad signature');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new JwtError('bad payload');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new JwtError('bad payload');
  for (const claim of REQUIRED_CLAIMS) if (!(claim in payload)) throw new JwtError(`missing ${claim}`);
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) throw new JwtError('bad time claims');
  if (payload.iat > nowSeconds + leewaySeconds) throw new JwtError('issued in the future');
  if (payload.exp <= nowSeconds - leewaySeconds) throw new JwtExpired('expired');
  if (payload.iss !== issuer) throw new JwtError('bad issuer');
  return payload;
}

export function createToken(settings, { userId, tokenVersion, tokenType, now = new Date() }) {
  const expiresAt = new Date(now.getTime() + LIFETIMES_MS[tokenType]);
  const payload = {
    iss: JWT_ISSUER,
    sub: userId,
    typ: tokenType,
    ver: tokenVersion,
    jti: crypto.randomUUID().replaceAll('-', ''),
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  return { token: encodeJwt(payload, signingSecret(settings, tokenType)), expiresAt };
}

export function createSessionTokens(settings, { userId, tokenVersion, now = new Date() }) {
  const access = createToken(settings, { userId, tokenVersion, tokenType: ACCESS, now });
  const refresh = createToken(settings, { userId, tokenVersion, tokenType: REFRESH, now });
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
  };
}

/** Verify signature, expiry, issuer and type. Throws AuthenticationError. */
export function decodeToken(settings, token, tokenType, { now = new Date() } = {}) {
  if (!token || typeof token !== 'string') throw new AuthenticationError('not_authenticated');
  let payload;
  try {
    payload = decodeJwt(token, signingSecret(settings, tokenType), {
      issuer: JWT_ISSUER,
      leewaySeconds: JWT_LEEWAY_SECONDS,
      nowSeconds: Math.floor(now.getTime() / 1000),
    });
  } catch (err) {
    if (err instanceof JwtExpired) throw new AuthenticationError('token_expired');
    if (err instanceof JwtError) throw new AuthenticationError('invalid_token');
    throw err;
  }
  if (payload.typ !== tokenType) throw new AuthenticationError('invalid_token');
  if (typeof payload.sub !== 'string' || !Number.isInteger(payload.ver)) throw new AuthenticationError('invalid_token');
  return {
    userId: payload.sub,
    tokenType,
    tokenVersion: payload.ver,
    jti: String(payload.jti),
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
  };
}
