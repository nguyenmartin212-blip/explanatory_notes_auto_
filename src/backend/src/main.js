// Entry point:  npm start   (listens on PORT, default 3000: the port the mobile app calls)
import express from 'express';
import { pathToFileURL } from 'node:url';
import { getSettings } from './core/config.js';
import { logger } from './core/logger.js';
import { runShutdown, runStartup } from './startup.js';

/** CORS for browser clients such as Expo web (no extra dependency). Credentials only for listed origins. */
export function corsMiddleware(origins) {
  const any = origins.includes('*');
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (any || origins.includes(origin))) {
      res.set('Access-Control-Allow-Origin', any ? '*' : origin);
      if (!any) {
        res.set('Access-Control-Allow-Credentials', 'true');
        res.vary('Origin');
      }
      res.set('Access-Control-Expose-Headers', 'ETag, Retry-After');
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
        res.set('Access-Control-Max-Age', '600');
        return res.status(200).end();
      }
    }
    return next();
  };
}

export function createApp(settings = getSettings()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // ETags are produced by the routes
  app.locals.settings = settings;
  app.locals.state = { ready: false };
  if (settings.corsOrigins.length) app.use(corsMiddleware(settings.corsOrigins));
  return app;
}

export async function start() {
  const settings = getSettings();
  const app = createApp(settings);
  await runStartup(app, settings);
  const server = app.listen(settings.port, () => logger.info(`Listening on http://localhost:${settings.port}`));

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received: shutting down`);
    server.close();
    await runShutdown(app);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  return { app, server };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    logger.error(err.message);
    process.exit(1);
  });
}
