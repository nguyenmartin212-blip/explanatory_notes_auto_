// httpOnly auth cookies. `res` is an Express response (cookie / clearCookie).
import {
  ACCESS_COOKIE_NAME, ACCESS_TOKEN_MINUTES, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_DAYS,
} from './constants.js';

export const SAMESITE_VALUES = ['lax', 'strict', 'none'];

export function cookieSecure(settings) {
  const explicit = settings.authCookieSecure;
  return explicit !== null && explicit !== undefined ? Boolean(explicit) : !settings.isDevelopment;
}

function attrs(settings) {
  let samesite = String(settings.authCookieSamesite ?? 'lax').toLowerCase();
  if (!SAMESITE_VALUES.includes(samesite)) samesite = 'lax';
  const secure = cookieSecure(settings) || samesite === 'none'; // browsers reject SameSite=None without Secure
  const out = {
    httpOnly: true, // not readable from JavaScript
    secure,
    sameSite: samesite,
  };
  if (settings.authCookieDomain) out.domain = settings.authCookieDomain;
  return out;
}

export function setAuthCookies(res, settings, session) {
  const a = attrs(settings);
  res.cookie(ACCESS_COOKIE_NAME, session.accessToken, { ...a, maxAge: ACCESS_TOKEN_MINUTES * 60 * 1000, path: '/' });
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    ...a,
    maxAge: REFRESH_TOKEN_DAYS * 24 * 3600 * 1000,
    path: REFRESH_COOKIE_PATH,
  });
}

export function clearAuthCookies(res, settings) {
  const a = attrs(settings);
  res.clearCookie(ACCESS_COOKIE_NAME, { ...a, path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...a, path: REFRESH_COOKIE_PATH });
}

/** Minimal Cookie header parser (no cookie-parser dependency). */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}
