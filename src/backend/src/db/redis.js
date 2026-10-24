// Step 2b — Redis connection (node-redis v4).
import { StartupError } from '../core/errors.js';

export async function connectRedis(settings) {
  const { createClient } = await import('redis');
  const client = createClient({ url: settings.redisUrl });
  client.on('error', () => {}); // errors surface through the calls (ping / fail-closed paths)
  try {
    await client.connect();
    await client.ping();
  } catch (err) {
    await client.disconnect().catch(() => {});
    throw new StartupError(`Cannot connect to Redis: ${err.message}`);
  }
  return client;
}
