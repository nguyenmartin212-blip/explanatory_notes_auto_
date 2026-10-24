// Media storage helpers: startup check (Chapter 02) and cleanup (Chapter 05).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StartupError } from '../core/errors.js';
import { logger } from '../core/logger.js';

/** Return true if checked, false if skipped (backend 'none'). */
export async function checkMediaStorage(settings) {
  const backend = settings.mediaStorageBackend.trim().toLowerCase();
  if (backend === 'none') return false;
  if (backend !== 'local') throw new StartupError(`Unsupported MEDIA_STORAGE_BACKEND '${backend}' (use 'local' or 'none')`);
  try {
    await fs.mkdir(settings.mediaDir, { recursive: true });
    const probe = path.join(settings.mediaDir, `.write-check-${crypto.randomUUID().replaceAll('-', '')}`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
  } catch (err) {
    throw new StartupError(`Media storage '${settings.mediaDir}' is not writable: ${err.message}`);
  }
  return true;
}

/**
 * Best-effort delete of one stored file by its storage key. Returns true if a file was removed.
 * Never throws: cleanup must not break the data operation that triggered it.
 * Keys escaping the media dir are refused.
 */
export async function deleteMedia(settings, key) {
  if (!key || settings.mediaStorageBackend.trim().toLowerCase() !== 'local') return false;
  try {
    const base = path.resolve(settings.mediaDir);
    const target = path.resolve(base, String(key).replace(/^[/\\]+/, ''));
    if (!target.startsWith(base + path.sep)) {
      logger.warn(`Refusing to delete media outside media dir: ${JSON.stringify(key)}`);
      return false;
    }
    await fs.unlink(target);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    logger.warn(`Media cleanup failed for ${JSON.stringify(key)}: ${err.message}`);
    return false;
  }
}
