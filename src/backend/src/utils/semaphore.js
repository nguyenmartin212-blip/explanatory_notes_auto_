/** Counting semaphore with an optional acquire timeout (replaces asyncio.Semaphore). */
export class Semaphore {
  constructor(count) {
    this.free = count;
    this.waiters = [];
  }

  /** Resolve true when a slot was taken, false on timeout. */
  acquire(timeoutSeconds = null) {
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      if (timeoutSeconds !== null) {
        waiter.timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(false);
        }, timeoutSeconds * 1000);
      }
      this.waiters.push(waiter);
    });
  }

  release() {
    const next = this.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(true);
    } else {
      this.free += 1;
    }
  }
}
