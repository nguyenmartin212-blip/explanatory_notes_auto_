// Step 4a — recover audio tasks interrupted by a restart.
import { logger } from '../core/logger.js';
import { audioTaskStore } from '../stores/index.js';

export async function recoverAudioTasks(db) {
  const count = await audioTaskStore.requeueAllRunning(db);
  if (count) logger.warn(`Recovered ${count} interrupted audio task(s)`);
  return count;
}
