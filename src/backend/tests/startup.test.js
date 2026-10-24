// Chapter 01–02: security guard, media / runtime storage, seeding and the worker registry.
// (The HTTP side of the startup — order of the steps, /health, routes — is in http.test.js.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadSettings } from '../src/core/config.js';
import { StartupError } from '../src/core/errors.js';
import { validateSecurityConfig } from '../src/core/securityGuard.js';
import { DEFAULT_ROLES } from '../src/auth/permissions.js';
import { checkMediaStorage } from '../src/services/mediaStorage.js';
import { prepareRuntimeStorage, runSeeding, seedSuperAdmin } from '../src/services/seeding.js';
import { WorkerManager } from '../src/workers/manager.js';
import { sleep } from './helpers/fakeTts.js';
import { makeWorld } from './helpers/world.js';

const GOOD = {
  JWT_SECRET: 'a'.repeat(40),
  REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  SECRET_KEY: 'c'.repeat(40),
};

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ena-start-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const settingsWith = (overrides = {}) => loadSettings({
  APP_ENV: 'production',
  RUNTIME_DIR: path.join(tmp, 'runtime'),
  STATIC_DIR: path.join(tmp, 'runtime', 'static'),
  TTS_CACHE_DIR: path.join(tmp, 'runtime', 'tts-cache'),
  MEDIA_DIR: path.join(tmp, 'runtime', 'media'),
  ...GOOD,
  ...overrides,
});

const guardFails = (settings, pattern) => assert.throws(() => validateSecurityConfig(settings), (err) => {
  assert.ok(err instanceof StartupError);
  assert.match(err.message, pattern);
  return true;
});

describe('step 1: security guard', () => {
  it('skips the secrets in development', () => {
    validateSecurityConfig(settingsWith({ APP_ENV: 'development', JWT_SECRET: '' }));
  });

  it('accepts a good production configuration', () => validateSecurityConfig(settingsWith()));

  for (const field of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'SECRET_KEY']) {
    it(`rejects a missing ${field} in production`, () => guardFails(settingsWith({ [field]: '' }), new RegExp(field)));
  }

  it('rejects short, placeholder and duplicate secrets', () => {
    guardFails(settingsWith({ JWT_SECRET: 'short' }), /at least 32/);
    guardFails(settingsWith({ JWT_SECRET: `changeme${'x'.repeat(30)}` }), /placeholder/);
    guardFails(settingsWith({ SECRET_KEY: GOOD.JWT_SECRET }), /different/);
  });

  it('checks the super admin bootstrap settings', () => {
    guardFails(settingsWith({ SUPERADMIN_BOOTSTRAP_MODE: 'always' }), /SUPERADMIN_BOOTSTRAP_MODE/);
    guardFails(settingsWith({ SUPERADMIN_BOOTSTRAP_MODE: 'env' }), /SUPERADMIN_USERNAME/);
    guardFails(settingsWith({ SUPERADMIN_BOOTSTRAP_MODE: 'env', SUPERADMIN_USERNAME: 'root', SUPERADMIN_PASSWORD: 'short' }), /at least 12/);
    validateSecurityConfig(settingsWith({
      SUPERADMIN_BOOTSTRAP_MODE: 'env', SUPERADMIN_USERNAME: 'root', SUPERADMIN_PASSWORD: 'a-long-enough-password',
    }));
  });

  it('reports every problem at once', () => {
    guardFails(settingsWith({ JWT_SECRET: '', SECRET_KEY: '' }), /JWT_SECRET[\s\S]*SECRET_KEY/);
  });
});

describe('step 2c / 3: media and runtime storage', () => {
  it('media check is skipped when the backend is none', async () => {
    const settings = settingsWith({ MEDIA_STORAGE_BACKEND: 'none' });
    assert.equal(await checkMediaStorage(settings), false);
    assert.equal(fs.existsSync(settings.mediaDir), false);
  });

  it('an unknown backend is rejected', async () => {
    await assert.rejects(checkMediaStorage(settingsWith({ MEDIA_STORAGE_BACKEND: 's3' })), StartupError);
  });

  it('the media check and runtime storage create the directories', async () => {
    const settings = settingsWith();
    assert.equal(await checkMediaStorage(settings), true);
    await prepareRuntimeStorage(settings);
    for (const dir of [settings.mediaDir, settings.staticDir, settings.ttsCacheDir]) assert.ok(fs.statSync(dir).isDirectory());
  });

  it('an unwritable media directory fails the startup', async () => {
    const blocker = path.join(tmp, 'file');
    fs.writeFileSync(blocker, 'x');
    await assert.rejects(checkMediaStorage(settingsWith({ MEDIA_DIR: path.join(blocker, 'media') })), StartupError);
  });
});

describe('step 3: seeding', () => {
  const hasher = { hash: async (p) => `h:${p}` };
  const bootstrap = { SUPERADMIN_BOOTSTRAP_MODE: 'env', SUPERADMIN_USERNAME: 'Root', SUPERADMIN_PASSWORD: 'a-long-enough-password' };

  it('inserts the default roles once and never overwrites edited roles', async () => {
    const w = makeWorld();
    const settings = settingsWith();
    await runSeeding(w.db, settings, { hasher });
    const roles = w.db.collection('roles').docs;
    assert.deepEqual(roles.map((r) => r.name).sort(), DEFAULT_ROLES.map((r) => r.name).sort());
    w.db.collection('roles').docs.find((r) => r.name === 'admin').permissions = ['poi:read'];
    await runSeeding(w.db, settings, { hasher });
    assert.equal(w.db.collection('roles').docs.length, 2);
    assert.deepEqual(w.db.collection('roles').docs.find((r) => r.name === 'admin').permissions, ['poi:read']);
    w.cleanup();
  });

  it('bootstrap mode disabled creates no admin', async () => {
    const w = makeWorld();
    await runSeeding(w.db, settingsWith(), { hasher });
    assert.equal(w.db.collection('admin_users').docs.length, 0);
    w.cleanup();
  });

  it('bootstrap mode env creates the super admin once', async () => {
    const w = makeWorld();
    const settings = settingsWith(bootstrap);
    await runSeeding(w.db, settings, { hasher });
    await runSeeding(w.db, settings, { hasher });
    const users = w.db.collection('admin_users').docs;
    assert.equal(users.length, 1);
    assert.deepEqual([users[0].username, users[0].role, users[0].password_hash], ['root', 'super_admin', 'h:a-long-enough-password']);
    assert.equal(await seedSuperAdmin(w.db, settings, { hasher }), false);
    w.cleanup();
  });

  it('backfills user_id / token_version of old accounts', async () => {
    const w = makeWorld();
    await w.db.collection('admin_users').insertOne({ username: 'old', password_hash: 'x', role: 'admin' });
    await runSeeding(w.db, settingsWith(), { hasher });
    const user = w.db.collection('admin_users').docs[0];
    assert.ok(user.user_id);
    assert.equal(user.token_version, 0);
    w.cleanup();
  });
});

describe('step 4b: worker manager', () => {
  it('starts workers, reports health and stops them', async () => {
    const workers = new WorkerManager();
    let stopped = 0;
    workers.start('a', async (signal) => { while (!signal.aborted) await sleep(5); stopped += 1; });
    workers.start('b', async (signal) => { while (!signal.aborted) await sleep(5); stopped += 1; });
    assert.deepEqual(workers.names, ['a', 'b']);
    assert.equal(workers.isHealthy(), true);
    assert.throws(() => workers.start('a', async () => {}), /already started/);
    await workers.stop();
    assert.equal(stopped, 2);
    assert.deepEqual(workers.names, []);
  });

  it('a crashed worker makes the manager unhealthy', async () => {
    const workers = new WorkerManager();
    workers.start('ok', async (signal) => { while (!signal.aborted) await sleep(5); });
    workers.start('bad', async () => { throw new Error('boom'); });
    await sleep(30);
    assert.equal(workers.isHealthy(), false);
    await workers.stop();
  });
});
