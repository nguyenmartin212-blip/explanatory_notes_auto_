// Step 2a — MongoDB connection and transaction capability check.
import { StartupError } from '../core/errors.js';
import { logger } from '../core/logger.js';

export async function connectMongo(settings) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(settings.mongoUri, {
    serverSelectionTimeoutMS: settings.mongoServerSelectionTimeoutMs,
  });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
  } catch (err) {
    await client.close().catch(() => {});
    throw new StartupError(`Cannot connect to MongoDB: ${err.message}`);
  }
  return { client, db: client.db(settings.mongoDb) };
}

/** Transactions need a replica set or a sharded cluster (mongos). */
export async function checkTransactionSupport(client, settings) {
  const hello = await client.db('admin').command({ hello: 1 });
  const supported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  if (!supported) {
    const message = 'MongoDB does not support transactions (standalone server; use a replica set)';
    if (settings.isDevelopment) logger.warn(message);
    else throw new StartupError(message);
  }
  return supported;
}
