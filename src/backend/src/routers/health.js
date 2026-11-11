import { Router } from 'express';
import { wrap } from '../core/http.js';

export const router = Router();

/** Liveness: the process is up. */
router.get('/health', (req, res) => res.json({ status: 'ok' }));

/** Readiness: startup finished and Mongo, Redis and workers are healthy. */
router.get('/health/ready', wrap(async (req, res) => {
  const state = req.app.locals.state;
  const checks = { startup: Boolean(state.ready) };
  if (checks.startup) {
    try {
      await state.mongoClient.db('admin').command({ ping: 1 });
      checks.mongodb = true;
    } catch {
      checks.mongodb = false;
    }
    try {
      await state.redis.ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
    }
    checks.workers = state.workers.isHealthy();
  }
  const isReady = Object.values(checks).every(Boolean);
  res.status(isReady ? 200 : 503).json({ status: isReady ? 'ready' : 'not_ready', checks });
}));
