// Chapter 07: tokens, RBAC, roles (admin accounts only: there are no user / owner accounts).
// Real JWT/Fernet code + the real stores running on the in-memory fake MongoDB; fake Redis and fake bcrypt.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { authorize, buildContext, extractToken } from '../src/auth/context.js';
import * as perms from '../src/auth/permissions.js';
import { ACCESS, REFRESH, createToken, decodeToken, encodeJwt } from '../src/auth/tokens.js';
import { ConflictError, NotFoundError, PermissionDenied, ValueError } from '../src/core/errors.js';
import * as authService from '../src/services/authService.js';
import * as roleService from '../src/services/roleService.js';
import { adminUserStore, roleStore } from '../src/stores/index.js';
import { FakeRedis } from './helpers/fakeRedis.js';
import { makeWorld } from './helpers/world.js';

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-01-01T00:00:00Z');
const SETTINGS = {
  jwtSecret: 'a'.repeat(40),
  refreshTokenSecret: 'b'.repeat(40),
  secretKey: 'c'.repeat(40),
  isDevelopment: false,
};

const hasher = {
  hash: async (p) => `h:${p}`,
  verify: async (p, h) => h === `h:${p}`,
  dummyVerify: async () => {},
};

async function rejectsWith(promiseFactory, ErrorClass, check = () => {}) {
  await assert.rejects(promiseFactory, (err) => {
    assert.ok(err instanceof ErrorClass, `expected ${ErrorClass.name}, got ${err?.name}: ${err?.message}`);
    check(err);
    return true;
  });
}
const throwsWith = (fn, ErrorClass, check = () => {}) => {
  try { fn(); } catch (err) { assert.ok(err instanceof ErrorClass, `expected ${ErrorClass.name}, got ${err?.name}`); check(err); return; }
  assert.fail(`expected ${ErrorClass.name}`);
};

/** DB + Redis + helpers shared by the suites. */
async function setup() {
  const w = await makeWorld().init();
  await roleStore.insertMissingRoles(w.db, perms.DEFAULT_ROLES);
  const redis = new FakeRedis();
  const users = w.db.collection('admin_users');
  const audit = () => w.db.collection('audit_logs').docs;
  return {
    w, db: w.db, redis, audit,
    async addUser(id, role, { password = 'pw', ...extra } = {}) {
      await users.insertOne({
        user_id: id, username: id, password_hash: `h:${password}`, role, is_active: true,
        token_version: 0, ...extra,
      });
    },
    getUser: (id) => users.docs.find((u) => u.user_id === id),
    setRolePermissions: (name, permissions) => w.db.collection('roles').updateOne({ name }, { $set: { permissions } }),
    async ctx(id) {
      const user = await adminUserStore.getById(w.db, id);
      return buildContext(user, await roleStore.get(w.db, user.role));
    },
  };
}

describe('catalog and tokens', () => {
  test('29 permissions in 9 domains', () => {
    assert.equal(perms.ALL_PERMISSIONS.size, 29);
    assert.equal(perms.DOMAINS.length, 9);
  });

  test('default roles: only super_admin and admin', () => {
    assert.deepEqual(new Set(perms.DEFAULT_ROLES.map((r) => r.name)), new Set(['super_admin', 'admin']));
  });

  test('token lifetimes: access 30 min, refresh 7 days', () => {
    const a = createToken(SETTINGS, { userId: 'u', tokenVersion: 0, tokenType: ACCESS, now: NOW });
    const r = createToken(SETTINGS, { userId: 'u', tokenVersion: 0, tokenType: REFRESH, now: NOW });
    assert.equal(a.expiresAt - NOW, 30 * 60 * 1000);
    assert.equal(r.expiresAt - NOW, 7 * DAY);
  });

  test('token type and signature are checked', () => {
    const r = createToken(SETTINGS, { userId: 'u', tokenVersion: 0, tokenType: REFRESH, now: NOW });
    throwsWith(() => decodeToken(SETTINGS, r.token, ACCESS, { now: NOW }), Error);
    const a = createToken(SETTINGS, { userId: 'u', tokenVersion: 0, tokenType: ACCESS, now: NOW });
    const other = { ...SETTINGS, jwtSecret: 'z'.repeat(40) };
    throwsWith(() => decodeToken(other, a.token, ACCESS, { now: NOW }), Error, (e) => assert.equal(e.code, 'invalid_token'));
  });

  test('expired token', () => {
    const a = createToken(SETTINGS, { userId: 'u', tokenVersion: 0, tokenType: ACCESS, now: new Date(Date.now() - 3600_000) });
    throwsWith(() => decodeToken(SETTINGS, a.token, ACCESS), Error, (e) => assert.equal(e.code, 'token_expired'));
  });

  test('"alg: none" and tampered tokens are rejected', () => {
    const a = createToken(SETTINGS, { userId: 'u', tokenVersion: 0, tokenType: ACCESS });
    const [, body] = a.token.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${body}.`;
    throwsWith(() => decodeToken(SETTINGS, none, ACCESS), Error, (e) => assert.equal(e.code, 'invalid_token'));
    const tampered = `${a.token.split('.').slice(0, 2).join('.')}.${'A'.repeat(43)}`;
    throwsWith(() => decodeToken(SETTINGS, tampered, ACCESS), Error, (e) => assert.equal(e.code, 'invalid_token'));
    for (const junk of ['', 'a.b', 'not a jwt', null]) {
      throwsWith(() => decodeToken(SETTINGS, junk, ACCESS), Error);
    }
  });

  test('a token without a required claim is rejected', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = encodeJwt({ iss: 'explanatory-notes-auto', sub: 'u', typ: 'access', iat: now, exp: now + 60 }, SETTINGS.jwtSecret);
    throwsWith(() => decodeToken(SETTINGS, token, ACCESS), Error, (e) => assert.equal(e.code, 'invalid_token'));
  });

  test('Bearer header wins over cookie', () => {
    assert.equal(extractToken('Bearer abc', 'cookie'), 'abc');
    assert.equal(extractToken(null, 'cookie'), 'cookie');
    assert.equal(extractToken('Basic abc', null), null);
  });
});

describe('authentication flows', () => {
  let t;
  beforeEach(async () => { t = await setup(); await t.addUser('admin1', 'admin'); });

  const login = () => authService.login(t.db, SETTINGS, 'Admin1', 'pw', { hasher });

  test('login and authenticate', async () => {
    const { session } = await login();
    const ctx = await authService.authenticate(t.db, t.redis, SETTINGS, session.accessToken);
    assert.equal(ctx.userId, 'admin1');
    assert.ok(!('password_hash' in authService.userView(ctx)));
    assert.ok(t.getUser('admin1').last_login_at instanceof Date);
  });

  test('wrong password and unknown user give the same error', async () => {
    for (const [name, pw] of [['admin1', 'bad'], ['nobody', 'pw']]) {
      await rejectsWith(() => authService.login(t.db, SETTINGS, name, pw, { hasher }), Error, (e) => assert.equal(e.code, 'invalid_credentials'));
    }
  });

  test('disabled account', async () => {
    t.getUser('admin1').is_active = false;
    await rejectsWith(login, Error, (e) => assert.equal(e.code, 'account_disabled'));
  });

  test('refresh rotation is single use', async () => {
    const { session: s } = await login();
    const { session: s2 } = await authService.refreshSession(t.db, t.redis, SETTINGS, s.refreshToken);
    assert.notEqual(s.refreshToken, s2.refreshToken);
    await rejectsWith(() => authService.refreshSession(t.db, t.redis, SETTINGS, s.refreshToken), Error, (e) => assert.equal(e.code, 'invalid_token'));
  });

  test('concurrent use of one refresh token: exactly one wins', async () => {
    const { session: s } = await login();
    const results = await Promise.allSettled([1, 2, 3].map(() => authService.refreshSession(t.db, t.redis, SETTINGS, s.refreshToken)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  });

  test('an access token cannot refresh', async () => {
    const { session: s } = await login();
    await rejectsWith(() => authService.refreshSession(t.db, t.redis, SETTINGS, s.accessToken), Error, (e) => assert.equal(e.code, 'invalid_token'));
  });

  test('logout revokes both tokens', async () => {
    const { session: s } = await login();
    const n = await authService.logout(t.redis, SETTINGS, { accessToken: s.accessToken, refreshToken: s.refreshToken });
    assert.equal(n, 2);
    await rejectsWith(() => authService.authenticate(t.db, t.redis, SETTINGS, s.accessToken), Error);
    await rejectsWith(() => authService.refreshSession(t.db, t.redis, SETTINGS, s.refreshToken), Error);
  });

  test('logout with garbage is harmless', async () => {
    assert.equal(await authService.logout(t.redis, SETTINGS, { accessToken: 'junk' }), 0);
  });

  test('token_version bump invalidates every token', async () => {
    const { session: s } = await login();
    assert.equal(await authService.revokeAllSessions(t.db, 'admin1'), true);
    await rejectsWith(() => authService.authenticate(t.db, t.redis, SETTINGS, s.accessToken), Error);
  });

  test('account deactivated after login', async () => {
    const { session: s } = await login();
    t.getUser('admin1').is_active = false;
    await rejectsWith(() => authService.authenticate(t.db, t.redis, SETTINGS, s.accessToken), Error, (e) => assert.equal(e.code, 'account_disabled'));
  });

  test('fail closed when Redis is down', async () => {
    const { session: s } = await login();
    t.redis.fail = true;
    await rejectsWith(() => authService.authenticate(t.db, t.redis, SETTINGS, s.accessToken), Error, (e) => assert.equal(e.code, 'auth_unavailable'));
  });

  test('a role change applies immediately', async () => {
    const { session: s } = await login();
    await t.setRolePermissions('admin', []);
    const ctx = await authService.authenticate(t.db, t.redis, SETTINGS, s.accessToken);
    throwsWith(() => authorize(ctx, ['poi:delete']), PermissionDenied);
  });

  test('tokenResponse shape', async () => {
    const { session } = await login();
    const body = authService.tokenResponse(session);
    assert.equal(body.token_type, 'bearer');
    assert.equal(body.expires_in, 1800);
    assert.equal(body.refresh_expires_in, 7 * 24 * 3600);
  });
});

describe('RBAC', () => {
  let t;
  beforeEach(async () => { t = await setup(); });
  const denied = (id, required, check) => rejectsWith(async () => authorize(await t.ctx(id), required), PermissionDenied, check);

  test('super_admin wildcard', async () => {
    await t.addUser('root', 'super_admin');
    authorize(await t.ctx('root'), ['poi:delete', 'role:delete']);
  });

  test('an admin without the permission is denied; the missing permission is reported', async () => {
    await t.addUser('adm', 'admin');
    await t.setRolePermissions('admin', ['poi:read']);
    await denied('adm', ['poi:delete'], (e) => assert.deepEqual(e.missing, ['poi:delete']));
    authorize(await t.ctx('adm'), ['poi:read']);
  });

  test('default admin cannot manage roles or delete users', async () => {
    await t.addUser('adm', 'admin');
    await denied('adm', ['role:create']);
    await denied('adm', ['user:delete']);
    authorize(await t.ctx('adm'), ['poi:delete', 'audio:manage']);
  });

  test('a user whose role no longer exists is denied', async () => {
    await t.addUser('x', 'ghost');
    await denied('x', ['poi:read']);
  });
});

describe('role service', () => {
  let t;
  beforeEach(async () => {
    t = await setup();
    await t.addUser('root', 'super_admin');
    await t.addUser('adm', 'admin');
    await roleStore.create(t.db, { name: 'viewer', description: '', permissions: ['poi:read'], is_default: false });
    await t.addUser('usr', 'viewer');
  });

  test('create a dynamic role', async () => {
    const role = await roleService.createRole(t.db, await t.ctx('root'), { name: 'editor', permissions: ['poi:read'] });
    assert.deepEqual(role.permissions, ['poi:read']);
    assert.ok(await roleStore.get(t.db, 'editor'));
  });

  test('unknown permission, wildcard and bad names are rejected', async () => {
    const ctx = await t.ctx('root');
    for (const bad of [['nope:nope'], ['*']]) {
      await rejectsWith(() => roleService.createRole(t.db, ctx, { name: 'r1', permissions: bad }), ValueError);
    }
    await rejectsWith(() => roleService.createRole(t.db, ctx, { name: 'Bad Name!', permissions: [] }), ValueError);
  });

  test('requires role:create', async () => {
    await rejectsWith(async () => roleService.createRole(t.db, await t.ctx('usr'), { name: 'r1', permissions: [] }), PermissionDenied);
  });

  test('cannot grant what you lack', async () => {
    await t.setRolePermissions('admin', ['role:create', 'poi:read']);
    await rejectsWith(async () => roleService.createRole(t.db, await t.ctx('adm'), { name: 'r2', permissions: ['poi:delete'] }), PermissionDenied);
  });

  test('super_admin is immutable; default roles cannot be deleted', async () => {
    const ctx = await t.ctx('root');
    await rejectsWith(() => roleService.updateRole(t.db, ctx, 'super_admin', { permissions: ['poi:read'] }), ConflictError);
    await rejectsWith(() => roleService.deleteRole(t.db, ctx, 'admin'), ConflictError);
  });

  test('a role in use cannot be deleted', async () => {
    const ctx = await t.ctx('root');
    await roleService.createRole(t.db, ctx, { name: 'editor', permissions: ['poi:read'] });
    t.getUser('usr').role = 'editor';
    await rejectsWith(() => roleService.deleteRole(t.db, ctx, 'editor'), ConflictError);
    t.getUser('usr').role = 'viewer';
    await roleService.deleteRole(t.db, ctx, 'editor');
    assert.equal(await roleStore.get(t.db, 'editor'), null);
  });

  test('the last super admin cannot be demoted', async () => {
    await rejectsWith(async () => roleService.assignRole(t.db, await t.ctx('root'), 'root', 'admin'), ConflictError);
  });

  test('an admin cannot hand out super_admin', async () => {
    await t.setRolePermissions('admin', ['user:update']);
    await rejectsWith(async () => roleService.assignRole(t.db, await t.ctx('adm'), 'usr', 'super_admin'), PermissionDenied);
  });

  test('assign a role', async () => {
    const user = await roleService.assignRole(t.db, await t.ctx('root'), 'usr', 'admin');
    assert.equal(user.role, 'admin');
  });
});
