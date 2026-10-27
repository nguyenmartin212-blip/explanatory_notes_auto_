// Mounted at /admin
import { Router } from 'express';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../auth/constants.js';
import { buildContext, extractToken } from '../auth/context.js';
import { clearAuthCookies, parseCookies, setAuthCookies } from '../auth/cookies.js';
import { requireAuth, requirePermission } from '../auth/dependencies.js';
import { defaultHasher } from '../auth/passwords.js';
import { queryNumber, settingsOf, stateOf, wrap } from '../core/http.js';
import { PermissionDenied, ValidationError } from '../core/errors.js';
import { parseLoginRequest, parseRefreshRequest } from '../schemas/auth.js';
import * as audioSse from '../services/audioSse.js';
import * as authService from '../services/authService.js';
import { adminUserStore, roleStore, visitorVisitStore } from '../stores/index.js';
import * as roleService from '../services/roleService.js';

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

// ---- Account management -------------------------------------------------------------------------

function accountView(user) {
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email ?? null,
    role: user.role,
    is_active: Boolean(user.is_active),
    created_at: user.created_at ?? null,
    updated_at: user.updated_at ?? null,
    last_login_at: user.last_login_at ?? null,
  };
}

function requireObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError([
      { loc: ['body'], msg: 'Input should be a valid object' },
    ]);
  }
}

// GET /admin/users?limit=50&offset=0
router.get('/users', requirePermission('user:read'), wrap(async (req, res) => {
  const limit = queryNumber(req, 'limit', {
    def: 50, min: 1, max: 200, integer: true,
  });
  const offset = queryNumber(req, 'offset', {
    def: 0, min: 0, integer: true,
  });

  const { db } = stateOf(req);
  const { items, total } = await adminUserStore.listUsers(db, {
    limit,
    offset,
  });

  res.json({ items, total, limit, offset });
}));

// POST /admin/users
// Only a super admin may create accounts through this endpoint.
router.post('/users', requirePermission('user:create'), wrap(async (req, res) => {
  if (!req.auth.permissions.has('*')) {
    throw new PermissionDenied(
      'forbidden',
      'Only a super admin can create accounts',
    );
  }

  requireObjectBody(req.body);

  const { username, password, email = null, role } = req.body;

  if (
    typeof username !== 'string'
    || username.trim().length < 3
    || username.trim().length > 100
  ) {
    throw new ValidationError([
      { loc: ['body', 'username'], msg: 'Username must contain 3-100 characters' },
    ]);
  }

  if (typeof password !== 'string') {
    throw new ValidationError([
      { loc: ['body', 'password'], msg: 'Password is required' },
    ]);
  }

  if (typeof role !== 'string' || !role.trim()) {
    throw new ValidationError([
      { loc: ['body', 'role'], msg: 'A valid role is required' },
    ]);
  }

  if (
    email !== null
    && (typeof email !== 'string' || email.length > 254)
  ) {
    throw new ValidationError([
      { loc: ['body', 'email'], msg: 'Email must be a string of at most 254 characters or null' },
    ]);
  }

  const { db } = stateOf(req);
  const roleDoc = await roleStore.get(db, role.trim());

  if (!roleDoc) {
    throw new ValidationError([
      { loc: ['body', 'role'], msg: 'Role does not exist' },
    ]);
  }

  const passwordHash = await defaultHasher.hash(password);

  const user = await adminUserStore.createUser(db, {
    username: username.trim(),
    passwordHash,
    email: email?.trim() || null,
    role: roleDoc.name,
  });

  res.status(201).json({ user: accountView(user) });
}));

// PUT /admin/users/:user_id/role
router.put('/users/:user_id/role', requirePermission('user:update'), wrap(async (req, res) => {
  requireObjectBody(req.body);

  const role = req.body.role;
  if (typeof role !== 'string' || !role.trim()) {
    throw new ValidationError([
      { loc: ['body', 'role'], msg: 'Role is required' },
    ]);
  }

  const { db } = stateOf(req);
  const user = await roleService.assignRole(
    db,
    req.auth,
    req.params.user_id,
    role.trim(),
  );

  res.json({ user: accountView(user) });
}));

// GET /admin/roles
router.get('/roles', requirePermission('role:read'), wrap(async (req, res) => {
  const { db } = stateOf(req);
  const roles = await roleService.listRoles(db, req.auth);
  res.json({ items: roles });
}));

// PUT /admin/roles/:name
router.put('/roles/:name', requirePermission('role:update'), wrap(async (req, res) => {
  requireObjectBody(req.body);

  const { permissions, description } = req.body;

  if (
    permissions !== undefined
    && (!Array.isArray(permissions)
      || !permissions.every((permission) => typeof permission === 'string'))
  ) {
    throw new ValidationError([
      { loc: ['body', 'permissions'], msg: 'Permissions must be an array of strings' },
    ]);
  }

  if (description !== undefined && typeof description !== 'string') {
    throw new ValidationError([
      { loc: ['body', 'description'], msg: 'Description must be a string' },
    ]);
  }

  const { db } = stateOf(req);
  const role = await roleService.updateRole(
    db,
    req.auth,
    req.params.name,
    {
      permissions: permissions ?? null,
      description: description ?? null,
    },
  );

  res.json({ role });
}));

// ---- Anonymous visitor records ------------------------------------------------------------------
router.get('/visitor-visits', requirePermission('visitor:read'), wrap(async (req, res) => {
  const limit = queryNumber(req, 'limit', { def: 50, min: 1, max: 200, integer: true });
  const offset = queryNumber(req, 'offset', { def: 0, min: 0, integer: true });
  let poiId = null;

  if (req.query.poi_id !== undefined && req.query.poi_id !== '') {
    poiId = req.query.poi_id;
    if (typeof poiId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{1,80}$/.test(poiId)) {
      throw new ValidationError([{
        loc: ['query', 'poi_id'],
        msg: "String should match pattern '^[A-Za-z0-9][A-Za-z0-9-]{1,80}$'",
      }]);
    }
  }

  const { db } = stateOf(req);
  const { items, total } = await visitorVisitStore.listVisits(db, {
    limit,
    offset,
    poiId,
  });

  res.json({ items, total, limit, offset });
}));

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
