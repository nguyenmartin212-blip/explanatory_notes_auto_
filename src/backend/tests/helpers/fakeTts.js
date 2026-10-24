// Fake translator / synthesizer (replace Google Translate and Edge-TTS in tests).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class FakeTranslator {
  constructor() { this.calls = []; this.result = null; }

  async translate(text, source, target) {
    this.calls.push([text, source, target]);
    return this.result === null ? `[${target}] ${text}` : this.result;
  }
}

/** A promise you can resolve from outside (like asyncio.Event). */
export function makeGate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

export class FakeSynth {
  constructor() {
    this.calls = [];
    this.active = 0;
    this.maxActive = 0;
    this.gate = null;
    this.fail = null;
    this.empty = false;
    this.delay = 0;
  }

  async synthesize(text, voice, outPath) {
    this.calls.push([text, voice]);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.gate) await this.gate.promise;
      if (this.delay) await new Promise((r) => setTimeout(r, this.delay * 1000));
      if (this.fail) throw this.fail;
      await fs.writeFile(outPath, this.empty ? '' : Buffer.concat([Buffer.from('MP3:'), Buffer.from(text, 'utf8')]));
    } finally {
      this.active -= 1;
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `condition()` is true (or fail after `timeoutMs`). */
export async function until(condition, { timeoutMs = 3000, describe = () => '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`condition not reached ${describe()}`);
    await sleep(5);
  }
}

export function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ena-tts-'));
}
