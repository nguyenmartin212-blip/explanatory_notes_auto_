// Mounted at /api/analytics.
import { Router } from 'express';
import { requireAuth, requirePermission } from '../auth/dependencies.js';
import { stateOf, wrap } from '../core/http.js';
import * as analyticsService from '../services/analyticsService.js';

export const router = Router();

/** Authenticated clients send this periodically while the app is in use (recommended every 30-60 seconds). */
router.post('/devices/heartbeat', requireAuth, wrap(async (req, res) => {
  const result = await analyticsService.heartbeat(stateOf(req).db, req.auth, {
    deviceId: req.body?.device_id,
    deviceName: req.body?.device_name,
  });
  res.json({ ok: true, ...result });
}));

/** Admin analytics: currently connected devices plus usage sessions grouped by day or month. */
router.get('/usage', requirePermission('analytics:read'), wrap(async (req, res) => {
  const result = await analyticsService.getUsageSummary(stateOf(req).db, {
    period: req.query.period || 'day',
    from: req.query.from,
    to: req.query.to,
  });
  res.json(result);
}));
