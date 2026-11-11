import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HttpError } from '../src/core/errors.js';
import { DEVICE_PRESENCE, DEVICE_USAGE_SESSIONS } from '../src/db/collections.js';
import * as analyticsService from '../src/services/analyticsService.js';
import { makeWorld } from './helpers/world.js';

let w;
beforeEach(async () => { w = await makeWorld().init(); });
afterEach(() => w.cleanup());

const user = { userId: 'admin-1' };

describe('device analytics', () => {
  it('records a device and starts only one session during continuous use', async () => {
    const first = new Date('2026-10-24T10:00:00.000Z');
    const result = await analyticsService.heartbeat(w.db, user, {
      deviceId: 'device-abc', deviceName: 'Android phone',
    }, first);
    assert.equal(result.session_started, true);
    assert.equal(result.device_name, 'Android phone');

    const second = await analyticsService.heartbeat(w.db, user, {
      deviceId: 'device-abc', deviceName: 'Android phone',
    }, new Date('2026-10-24T10:01:00.000Z'));
    assert.equal(second.session_started, false);
    assert.equal(w.db.collection(DEVICE_PRESENCE).docs.length, 1);
    assert.equal(w.db.collection(DEVICE_USAGE_SESSIONS).docs.length, 1);
  });

  it('starts a new session after 30 minutes idle and rejects invalid device ids', async () => {
    await analyticsService.heartbeat(w.db, user, { deviceId: 'device-abc' }, new Date('2026-10-24T10:00:00.000Z'));
    const next = await analyticsService.heartbeat(w.db, user, { deviceId: 'device-abc' }, new Date('2026-10-24T10:31:00.000Z'));
    assert.equal(next.session_started, true);
    assert.equal(w.db.collection(DEVICE_USAGE_SESSIONS).docs.length, 2);
    await assert.rejects(
      analyticsService.heartbeat(w.db, user, { deviceId: 'invalid device id' }, new Date()),
      (error) => error instanceof HttpError && error.status === 422,
    );
  });

  it('returns connected devices and groups sessions by day/month', async () => {
    const now = new Date('2026-10-24T10:00:00.000Z');
    await analyticsService.heartbeat(w.db, user, { deviceId: 'phone', deviceName: 'Phone' }, new Date('2026-10-24T09:59:00.000Z'));
    await analyticsService.heartbeat(w.db, { userId: 'admin-2' }, { deviceId: 'tablet', deviceName: 'Tablet' }, new Date('2026-10-23T09:00:00.000Z'));

    const daily = await analyticsService.getUsageSummary(w.db, { period: 'day', from: '2026-10-23', to: '2026-10-24', now });
    assert.equal(daily.active_device_count, 1);
    assert.equal(daily.active_devices[0].device_name, 'Phone');
    assert.deepEqual(daily.usage.map((item) => [item.period, item.sessions, item.uniqueDevices]), [
      ['2026-10-23', 1, 1], ['2026-10-24', 1, 1],
    ]);

    const monthly = await analyticsService.getUsageSummary(w.db, { period: 'month', from: '2026-10-01', to: '2026-10-31', now });
    assert.deepEqual(monthly.usage.map((item) => [item.period, item.sessions]), [['2026-10', 2]]);
    assert.equal(monthly.total_sessions, 2);
  });

  it('validates period and date ranges', async () => {
    await assert.rejects(analyticsService.getUsageSummary(w.db, { period: 'year' }), (e) => e.status === 422);
    await assert.rejects(analyticsService.getUsageSummary(w.db, { period: 'day', from: '2026-02-30', to: '2026-03-01' }), (e) => e.status === 422);
    await assert.rejects(analyticsService.getUsageSummary(w.db, { period: 'day', from: '2026-10-24', to: '2026-10-23' }), (e) => e.status === 422);
  });
});
