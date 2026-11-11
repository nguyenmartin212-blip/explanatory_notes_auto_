// In-memory stand-in for the node-redis client (the subset the backend uses). `fail = true` simulates an outage.
export class FakeRedis {
  constructor(clock = () => Date.now()) {
    this.clock = clock;
    this.data = new Map(); // key -> { value, expiresAt|null }
    this.fail = false;
  }

  check() { if (this.fail) throw new Error('redis down'); }

  live(key) {
    const item = this.data.get(key);
    if (!item) return null;
    if (item.expiresAt !== null && item.expiresAt <= this.clock()) { this.data.delete(key); return null; }
    return item;
  }

  async ping() { this.check(); return 'PONG'; }
  async exists(key) { this.check(); return this.live(key) ? 1 : 0; }
  async get(key) { this.check(); return this.live(key)?.value ?? null; }

  async set(key, value, options = {}) {
    this.check();
    if (options.NX && this.live(key)) return null;
    this.data.set(key, { value: String(value), expiresAt: options.EX ? this.clock() + options.EX * 1000 : null });
    return 'OK';
  }

  async incr(key) {
    this.check();
    const item = this.live(key);
    const n = (item ? Number(item.value) : 0) + 1;
    this.data.set(key, { value: String(n), expiresAt: item ? item.expiresAt : null });
    return n;
  }

  async ttl(key) {
    this.check();
    const item = this.live(key);
    if (!item) return -2;
    return item.expiresAt === null ? -1 : Math.ceil((item.expiresAt - this.clock()) / 1000);
  }

  async expire(key, seconds) {
    this.check();
    const item = this.live(key);
    if (!item) return 0;
    item.expiresAt = this.clock() + seconds * 1000;
    return 1;
  }

  async del(key) { this.check(); return this.data.delete(key) ? 1 : 0; }
  async quit() {}
}
