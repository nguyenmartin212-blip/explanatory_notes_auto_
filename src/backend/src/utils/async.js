// Small async helpers (no dependencies).

/** Sleep `ms` (resolves early when `signal` aborts). */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Reject with `makeError()` when `promise` does not settle within `ms`. */
export function withTimeout(promise, ms, makeError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Like asyncio.Event used as a wake-up signal: set() wakes (or pre-wakes) the next wait(). */
export class Wake {
  constructor() {
    this.pending = false;
    this.waiters = new Set();
  }

  set() {
    this.pending = true;
    for (const done of [...this.waiters]) done();
  }

  wait(ms, signal) {
    if (this.pending || signal?.aborted) {
      this.pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        signal?.removeEventListener('abort', done);
        this.pending = false;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
