// Startup sequence. The order below is the contract from Chapter 01–02:
//   1. Security & Bootstrap Guard
//   2. Database / Cache / Media
//   3. Seeding & Runtime
//   4. Recovery & Background Workers
//   5. Mount API (11 routers, /health, /health/ready, /static)
// The app only becomes ready (app.locals.state.ready = true) after step 5.
import express from 'express';
import { errorMiddleware, notFoundMiddleware } from './core/errorHandlers.js';
import { logger } from './core/logger.js';
import { validateSecurityConfig } from './core/securityGuard.js';
import { checkTransactionSupport, connectMongo } from './db/mongo.js';
import { connectRedis } from './db/redis.js';
import { ROUTERS } from './routers/index.js';
import { router as healthRouter } from './routers/health.js';
import { recoverAudioTasks } from './services/audioRecovery.js';
import { AudioTaskManager } from './services/audioTaskManager.js';
import { LocalizationHydrator } from './services/localizationService.js';
import { checkMediaStorage } from './services/mediaStorage.js';
import { runSeeding } from './services/seeding.js';
import { TtsService } from './services/ttsService.js';
import { maintenanceLoop } from './workers/maintenance.js';
import { WorkerManager } from './workers/manager.js';

/** Step 5. */
export function mountApi(app, settings) {
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRouter);
  for (const { path, router } of ROUTERS) app.use(path || '/', router);
  app.use('/static', express.static(settings.staticDir));
  if (settings.mediaStorageBackend.trim().toLowerCase() === 'local') {
    // Generated audio files (audio_url = <prefix>/audio/<poi_id>/<lang>-<key>.mp3)
    app.use(settings.mediaPublicPrefix, express.static(settings.mediaDir));
  }
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
}

/**
 * Dependencies can be replaced (tests): { connectMongo, connectRedis, tts, hasher }.
 */
export async function runStartup(app, settings, overrides = {}) {
  const state = app.locals.state;
  state.ready = false;
  state.workers = new WorkerManager();
  state.mongoClient = null;
  state.redis = null;

  try {
    // 1. Security & Bootstrap Guard
    validateSecurityConfig(settings);

    // 2. Database / Cache / Media
    const connectDb = overrides.connectMongo || connectMongo;
    const { client, db } = await connectDb(settings);
    state.mongoClient = client;
    state.db = db;
    if (!overrides.connectMongo) await checkTransactionSupport(client, settings);
    state.redis = await (overrides.connectRedis || connectRedis)(settings);
    await checkMediaStorage(settings);

    // 3. Seeding & Runtime
    await runSeeding(db, settings, { hasher: overrides.hasher });

    // 4. Recovery & Background Workers
    await recoverAudioTasks(db);
    state.workers.start('maintenance', (signal) => maintenanceLoop(db, settings, signal));
    state.tts = overrides.tts || new TtsService(settings);
    state.audioTasks = new AudioTaskManager(db, settings, state.tts);
    state.workers.start('audio_tasks', (signal) => state.audioTasks.run(signal));
    state.localization = new LocalizationHydrator(db, settings, state.tts, { redis: state.redis });
    state.workers.start('localization', (signal) => state.localization.run(signal));

    // 5. Mount API
    mountApi(app, settings);
  } catch (err) {
    await runShutdown(app);
    throw err;
  }

  state.ready = true;
  logger.info(`Backend ready (workers: ${state.workers.names.join(', ')})`);
}

export async function runShutdown(app) {
  const state = app.locals.state;
  state.ready = false;
  await state.workers.stop();
  if (state.redis) await state.redis.quit().catch(() => {});
  if (state.mongoClient) await state.mongoClient.close().catch(() => {});
}
