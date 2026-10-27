import { HttpError } from '../core/errors.js';
import * as analyticsStore from '../stores/analyticsStore.js';

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const DEVICE_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;

/** Record a device heartbeat and start a new usage session after 30 minutes of inactivity. */
export async function heartbeat(db, user, { deviceId, deviceName }, now = new Date()) {
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    throw new HttpError(422, 'device_id must contain 1-128 letters, numbers, dots, underscores, colons or hyphens');
  }
  const name = typeof deviceName === 'string' ? deviceName.trim().slice(0, 100) : '';
  const safeName = name || 'Thiết bị không tên';
  const userId = user?.userId ?? user?.user_id;
  if (typeof userId !== 'string' || !userId) {
    throw new HttpError(401, 'Authenticated user id is unavailable');
  }

  const previous = await analyticsStore.getPresence(db, userId, deviceId);
  const lastSeen = previous?.last_seen_at instanceof Date ? previous.last_seen_at : null;
  const isNewSession = !lastSeen || now.getTime() - lastSeen.getTime() > SESSION_IDLE_MS;

  await analyticsStore.savePresence(db, { userId, deviceId, deviceName: safeName, now });
  if (isNewSession) {
    await analyticsStore.recordSession(db, { userId, deviceId, deviceName: safeName, startedAt: now });
  }
  return {
    device_id: deviceId,
    device_name: safeName,
    last_seen_at: now.toISOString(),
    session_started: isNewSession,
  };
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(422, `${label} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(422, `${label} is not a valid date`);
  }
  return date;
}

export async function getUsageSummary(db, { period = 'day', from, to, now = new Date() } = {}) {
  if (!['day', 'month'].includes(period)) {
    throw new HttpError(422, 'period must be day or month');
  }

  let start;
  let end;
  if (from || to) {
    if (!from || !to) throw new HttpError(422, 'from and to must be supplied together');
    start = parseDate(from, 'from');
    end = parseDate(to, 'to');
    if (end < start) throw new HttpError(422, 'to must be on or after from');
    // `to` is inclusive at the API boundary; the database range is exclusive.
    end.setUTCDate(end.getUTCDate() + 1);
  } else {
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    if (period === 'month') {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    } else {
      start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 29); // 30 calendar days including today
    }
  }

  const activeDevices = await analyticsStore.listActiveDevices(db, new Date(now.getTime() - ACTIVE_WINDOW_MS));
  const usage = await analyticsStore.countSessions(db, start, end, period);
  return {
    generated_at: now.toISOString(),
    timezone: 'UTC',
    active_device_count: activeDevices.length,
    active_devices: activeDevices.map((device) => ({
      user_id: device.user_id,
      device_id: device.device_id,
      device_name: device.device_name,
      last_seen_at: device.last_seen_at instanceof Date ? device.last_seen_at.toISOString() : device.last_seen_at,
    })),
    period,
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - 1).toISOString().slice(0, 10),
    usage,
    total_sessions: usage.reduce((sum, item) => sum + item.sessions, 0),
  };
}
