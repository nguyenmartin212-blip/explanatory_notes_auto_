// Password policy and hashing (bcrypt via `bcryptjs`, pure JavaScript: no native build on Windows).
// Plain passwords are never stored or logged. bcrypt only looks at the first 72 bytes, so longer passwords
// are rejected up front instead of being silently truncated. Hashes are the standard `$2a$/$2b$` format,
// so hashes created by the Python backend still verify.

import { ValueError } from '../core/errors.js';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;
export const BCRYPT_ROUNDS = 12;

export class PasswordPolicyError extends ValueError {
  constructor(message) { super(message); this.name = 'PasswordPolicyError'; }
}

export function validatePasswordPolicy(password) {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new PasswordPolicyError(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }
  if (!password.trim()) throw new PasswordPolicyError('Password cannot be blank');
}

async function loadBcrypt() {
  const mod = await import('bcryptjs');
  return mod.default ?? mod;
}

export class BcryptHasher {
  constructor(rounds = BCRYPT_ROUNDS) {
    this.rounds = rounds;
    this.dummyHash = null;
  }

  async hashRaw(password) {
    const bcrypt = await loadBcrypt();
    return bcrypt.hash(password, this.rounds);
  }

  async verifyRaw(password, hashed) {
    if (!hashed) return false;
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return false; // rejected when set
    const bcrypt = await loadBcrypt();
    try {
      return await bcrypt.compare(password, hashed);
    } catch {
      return false; // malformed hash
    }
  }

  async hash(password) {
    validatePasswordPolicy(password);
    return this.hashRaw(password);
  }

  async verify(password, hashed) {
    return this.verifyRaw(password, hashed);
  }

  /** Spend the same time as a real check, so an unknown username cannot be told apart from a wrong password. */
  async dummyVerify(password) {
    if (this.dummyHash === null) this.dummyHash = await this.hashRaw('dummy-password-for-timing');
    await this.verifyRaw(password, this.dummyHash);
  }
}

export const defaultHasher = new BcryptHasher();
