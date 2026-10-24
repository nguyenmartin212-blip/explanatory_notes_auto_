// Mounted at /admin
import { Router } from 'express';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../auth/constants.js';
import { buildContext, extractToken } from '../auth/context.js';
import { clearAuthCookies, parseCookies, setAuthCookies } from '../auth/cookies.js';
import { requireAuth, requirePermission } from '../auth/dependencies.js';
import { settingsOf, stateOf, wrap } from '../core/http.js';
import { parseLoginRequest, parseRefreshRequest } from '../schemas/auth.js';
import * as audioSse from '../services/audioSse.js';
import * as authService from '../services/authService.js';
import { roleStore } from '../stores/index.js';

export const router = Router();

// ---- Authentication (the refresh cookie is scoped to /admin/auth) --------------------------------
router.post('/auth/login', wrap(async (req, res) => {
  const body = parseLoginRequest(req.body);
  const settings = settingsOf(req);
  const { db } = stateOf(req);
  const { user, session } = await authService.login(db, settings, body.username, body.password);
  setAuthCookies(res, settings, session);
  const role = await roleStore.get(db, user.role);
  const ctx = buildContext(user, role);
  res.json({ ...authService.tokenResponse(session), user: authService.userView(ctx) });
}));

router.post('/auth/refresh', wrap(async (req, res) => {
  const body = parseRefreshRequest(req.body && Object.keys(req.body).length ? req.body : null);
  const settings = settingsOf(req);
  const { db, redis } = stateOf(req);
  const token = body.refresh_token || parseCookies(req.headers.cookie)[REFRESH_COOKIE_NAME];
  const { session } = await authService.refreshSession(db, redis, settings, token);
  setAuthCookies(res, settings, session);
  res.json(authService.tokenResponse(session));
}));

router.post('/auth/logout', wrap(async (req, res) => {
  const body = parseRefreshRequest(req.body && Object.keys(req.body).length ? req.body : null);
  const settings = settingsOf(req);
  const cookies = parseCookies(req.headers.cookie);
  const revoked = await authService.logout(stateOf(req).redis, settings, {
    accessToken: extractToken(req.headers.authorization, cookies[ACCESS_COOKIE_NAME]),
    refreshToken: body.refresh_token || cookies[REFRESH_COOKIE_NAME],
  });
  clearAuthCookies(res, settings);
  res.json({ logged_out: true, revoked_tokens: revoked });
}));

router.get('/auth/me', requireAuth, (req, res) => {
  res.json(authService.userView(req.auth));
});

// ---- Audio task progress (SSE) -------------------------------------------------------------------
/** Server-Sent Events: audio task progress (snapshot, then every change). */
router.get('/audio-tasks/stream', requirePermission('audio:manage'), wrap(async (req, res) => {
  const settings = settingsOf(req);
  let closed = false;
  res.on('close', () => { closed = true; });
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const stream = audioSse.eventStream(stateOf(req).db, {
    isDisconnected: async () => closed,
    pollSeconds: settings.audioSsePollSeconds,
  });
  for await (const chunk of stream) {
    if (closed) break;
    res.write(chunk);
  }
  res.end();
}));
