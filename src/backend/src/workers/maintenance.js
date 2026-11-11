// Maintenance loop: requeue audio tasks stuck in 'running'.
import { logger } from '../core/logger.js';
import { audioTaskStore } from '../stores/index.js';
import { abortableSleep } from './manager.js';

export async function maintenanceLoop(db, settings, signal) {
  while (!signal?.aborted) {
    await abortableSleep(settings.maintenanceIntervalSeconds * 1000, signal);
    if (signal?.aborted) break;
    try {
      const count = await audioTaskStore.requeueStaleRunning(db, settings.audioTaskStaleSeconds);
      if (count) logger.warn(`Requeued ${count} stale audio task(s)`);
    } catch (err) {
      logger.exception('Maintenance iteration failed', err);
    }
  }
}
