// HTTP layer: the real Express app (startup sequence, routers, error handling) on the fake MongoDB / Redis.
// Needs `npm install` (express, bcryptjs); without them the whole file is skipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadSettings } from '../src/core/config.js';
import { TtsService } from '../src/services/ttsService.js';
import { FakeRedis } from './helpers/fakeRedis.js';
import { FakeDb } from './helpers/fakeDb.js';
import { FakeSynth, FakeTranslator } from './helpers/fakeTts.js';

const available = async (name) => import(name).then(() => true, () => false);
const skip = (await available('express')) && (await available('bcryptjs')) ? false : 'express / bcryptjs are not installed (run npm install)';

describe('http', { skip }, () => {
  let dir, app, server, base, settings, redis, db, runShutdown, adminToken;
  const get = (url, init = {}) => fetch(base + url, init);
  const post = (url, body, headers = {}) => fetch(base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });

  before(async () => {
    process.env.LOG_LEVEL = 'silent';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ena-http-'));
    settings = loadSettings({
      APP_ENV: 'development',
      RUNTIME_DIR: path.join(dir, 'runtime'),
      STATIC_DIR: path.join(dir, 'runtime', 'static'),
      MEDIA_DIR: path.join(dir, 'runtime', 'media'),
      TTS_CACHE_DIR: path.join(dir, 'runtime', 'tts-cache'),
      SUPERADMIN_BOOTSTRAP_MODE: 'env',
      SUPERADMIN_USERNAME: 'root',
      SUPERADMIN_PASSWORD: 'a-long-enough-password',
      AUDIO_SSE_POLL_SECONDS: '0.05',
    });
    db = new FakeDb();
    redis = new FakeRedis();
    const { createApp } = await import('../src/main.js');
    const startup = await import('../src/startup.js');
    runShutdown = startup.runShutdown;
    const { seed, ensureIndexes } = await import('../scripts/seed-pois.js');
    await ensureIndexes(db);
    await seed(db, settings);
    app = createApp(settings);
    const client = { db: () => ({ command: async () => ({ ok: 1 }) }), close: async () => {} };
    const tts = new TtsService(settings, { translator: new FakeTranslator(), synthesizer: new FakeSynth() });
    await startup.runStartup(app, settings, { connectMongo: async () => ({ client, db }), connectRedis: async () => redis, tts });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await post('/admin/auth/login', { username: 'root', password: 'a-long-enough-password' });
    adminToken = (await login.json()).access_token;
  });

  after(async () => {
    server?.close();
    if (app) await runShutdown(app);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('health and readiness (503 when Redis is down)', async () => {
    assert.deepEqual(await (await get('/health')).json(), { status: 'ok' });
    const ready = await get('/health/ready');
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ready');
    redis.fail = true;
    const down = await get('/health/ready');
    redis.fail = false;
    assert.equal(down.status, 503);
    assert.equal((await down.json()).checks.redis, false);
  });

  it('device analytics heartbeat and protected usage summary', async () => {
    const heartbeat = await post('/api/analytics/devices/heartbeat', {
      device_id: 'http-test-device', device_name: 'Test Android',
    }, bearer(adminToken));
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = await heartbeat.json();
    assert.equal(heartbeatBody.device_id, 'http-test-device');
    assert.equal(heartbeatBody.device_name, 'Test Android');

    const unauthorized = await get('/api/analytics/usage?period=day');
    assert.equal(unauthorized.status, 401);
    const summary = await get('/api/analytics/usage?period=day', { headers: bearer(adminToken) });
    assert.equal(summary.status, 200);
    const body = await summary.json();
    assert.ok(body.active_device_count >= 1);
    assert.ok(body.active_devices.some((device) => device.device_id === 'http-test-device'));
    assert.ok(Array.isArray(body.usage));
  });

  it('GET /pois returns the FE shape with an ETag and answers 304', async () => {
    const res = await get('/pois');
    assert.equal(res.status, 200);
    const pois = await res.json();
    assert.equal(pois.length, 3);
    assert.ok(pois.every((p) => p.id && p.name.vi && typeof p.radiusMeters === 'number'));
    const etag = res.headers.get('etag');
    assert.ok(etag);
    assert.equal((await get('/pois', { headers: { 'If-None-Match': etag } })).status, 304);
  });

  it('GET /poi/load-all: full, then delta with the cursor', async () => {
    const full = await (await get('/poi/load-all?lang=vi')).json();
    assert.equal(full.count, 3);
    assert.equal(full.sync_mode, 'full');
    const delta = await (await get(`/poi/load-all?sync_cursor=${full.sync_cursor}`)).json();
    assert.deepEqual([delta.sync_mode, delta.count], ['delta', 0]);
    assert.equal((await get('/poi/load-all?lang=fr')).status, 422);
  });

  it('GET /poi/nearby validates its query', async () => {
    const ok = await (await get('/poi/nearby?lat=21.0353&lng=105.8402&radius=500')).json();
    assert.equal(ok.count, 1);
    assert.equal((await get('/poi/nearby?lat=abc&lng=1')).status, 422);
    assert.equal((await get('/poi/nearby?lat=91&lng=1')).status, 422);
    assert.equal((await get('/poi/nearby')).status, 422);
  });

  it('unknown routes answer 404 JSON; CORS is open in development', async () => {
    const res = await get('/nope', { headers: { Origin: 'http://localhost:8081' } });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { detail: 'Not Found' });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('login: wrong password 401, good login gives tokens + httpOnly cookies, /me, logout revokes', async () => {
    const bad = await post('/admin/auth/login', { username: 'root', password: 'wrong-password' });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('www-authenticate'), 'Bearer');
    assert.equal((await bad.json()).code, 'invalid_credentials');

    const ok = await post('/admin/auth/login', { username: 'root', password: 'a-long-enough-password' });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.token_type, 'bearer');
    assert.equal(body.user.role, 'super_admin');
    assert.deepEqual(body.user.permissions, ['*']);
    const cookies = ok.headers.getSetCookie().join('\n');
    assert.match(cookies, /access_token=.*HttpOnly/);
    assert.match(cookies, /refresh_token=.*Path=\/admin\/auth.*HttpOnly/);

    const me = await get('/admin/auth/me', { headers: bearer(body.access_token) });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).username, 'root');
    assert.equal((await get('/admin/auth/me')).status, 401);

    const out = await post('/admin/auth/logout', {}, bearer(body.access_token));
    assert.equal(out.status, 200);
    assert.equal((await get('/admin/auth/me', { headers: bearer(body.access_token) })).status, 401);
  });

  it('refresh rotates the token; the old one cannot be used again', async () => {
    const login = await (await post('/admin/auth/login', { username: 'root', password: 'a-long-enough-password' })).json();
    const next = await post('/admin/auth/refresh', { refresh_token: login.refresh_token });
    assert.equal(next.status, 200);
    assert.notEqual((await next.json()).refresh_token, login.refresh_token);
    assert.equal((await post('/admin/auth/refresh', { refresh_token: login.refresh_token })).status, 401);
  });

  it('fails closed (503) when Redis is down', async () => {
    redis.fail = true;
    const res = await get('/admin/auth/me', { headers: bearer(adminToken) });
    redis.fail = false;
    assert.equal(res.status, 503);
  });

  it('the audio progress stream needs audio:manage and sends a snapshot first', async () => {
    assert.equal((await get('/admin/audio-tasks/stream')).status, 401);
    const controller = new AbortController();
    const res = await get('/admin/audio-tasks/stream', { headers: bearer(adminToken), signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /^event: snapshot/);
    controller.abort();
  });

  it('POST /audio/tts streams an MP3 and reports the cache', async () => {
    const first = await post('/audio/tts', { text: 'Xin chào', lang: 'vi' });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'audio/mpeg');
    assert.equal(first.headers.get('x-audio-cache'), 'miss');
    assert.ok((await first.arrayBuffer()).byteLength > 0);
    assert.equal((await post('/audio/tts', { text: 'Xin chào', lang: 'vi' })).headers.get('x-audio-cache'), 'hit');
    assert.equal((await post('/audio/tts', { text: '', lang: 'vi' })).status, 422);
    assert.equal((await post('/audio/tts', { text: 'x', lang: 'fr' })).status, 422);
  });

  it('GET /audio/pack-manifest has an ETag', async () => {
    const res = await get('/audio/pack-manifest');
    assert.equal(res.status, 200);
    const etag = res.headers.get('etag');
    assert.match(etag, /^W\/"pack-/);
    assert.equal((await get('/audio/pack-manifest', { headers: { 'If-None-Match': etag } })).status, 304);
  });

  it('UI bundles: static language ready, long-tail pending', async () => {
    assert.equal((await (await get('/api/v1/ui-bundles/vi')).json()).status, 'ready');
    const th = await (await get('/api/v1/ui-bundles/th')).json();
    assert.deepEqual([th.status, th.fallback_locale], ['pending', 'en']);
    assert.equal((await get('/api/v1/ui-bundles/not%20a%20locale')).status, 422);
  });

  it('localization endpoints: hotset works and is rate limited with Retry-After', async () => {
    const hotset = await post('/localizations/prepare-hotset', { lat: 21.0353, lng: 105.8402, lang: 'ja' });
    assert.equal(hotset.status, 200);
    assert.equal((await hotset.json()).required_poi_ids.length > 0, true);
    const previous = settings.localizationRateLimitRequests;
    settings.localizationRateLimitRequests = 1;
    try {
      await post('/localizations/prepare-hotset', { lat: 1, lng: 1, lang: 'ko' });
      const limited = await post('/localizations/prepare-hotset', { lat: 1, lng: 1, lang: 'ko' });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    } finally {
      settings.localizationRateLimitRequests = previous;
    }
    assert.equal((await post('/localizations/prepare-hotset', { lat: 1, lng: 1, lang: 'fr' })).status, 422);
  });
});
