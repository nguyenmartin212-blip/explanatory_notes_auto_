// Step 4b — background worker registry.
// A worker is an async function `(signal) => Promise<void>` that loops until `signal` is aborted.
// If a worker's promise settles before stop() was called, the worker is considered dead (not healthy).
import { logger } from '../core/logger.js';

export class WorkerManager {
  constructor() {
    this.workers = new Map(); // name -> { promise, done }
    this.abort = new AbortController();
  }

  start(name, factory) {
    if (this.workers.has(name)) throw new Error(`Worker '${name}' already started`);
    const entry = { done: false, promise: null };
    entry.promise = Promise.resolve()
      .then(() => factory(this.abort.signal))
      .catch((err) => logger.exception(`Worker '${name}' crashed`, err))
      .finally(() => { entry.done = true; });
    this.workers.set(name, entry);
  }

  get names() { return [...this.workers.keys()]; }

  isHealthy() {
    return [...this.workers.values()].every((w) => !w.done);
  }

  async stop() {
    this.abort.abort();
    await Promise.allSettled([...this.workers.values()].map((w) => w.promise));
    this.workers.clear();
    this.abort = new AbortController();
  }
}

/** Sleep that ends early when `signal` is aborted. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
