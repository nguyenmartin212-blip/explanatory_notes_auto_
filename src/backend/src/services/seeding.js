// Step 3 — Seeding & runtime storage.
import fs from 'node:fs/promises';
import { defaultHasher } from '../auth/passwords.js';
import { DEFAULT_ROLES, SUPER_ADMIN_ROLE } from '../auth/permissions.js';
import { StartupError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import {
  adminUserStore, audioTaskStore, auditLogStore, poiDatasetStore, poiLocalizationStore, poiStore, roleStore, uiBundleStore,
} from '../stores/index.js';

export async function seedRoles(db) {
  await roleStore.ensureIndexes(db);
  await adminUserStore.ensureIndexes(db);
  await audioTaskStore.ensureIndexes(db);
  await poiStore.ensureIndexes(db);
  await poiLocalizationStore.ensureIndexes(db);
  await poiDatasetStore.ensureIndexes(db);
  await auditLogStore.ensureIndexes(db);
  await uiBundleStore.ensureIndexes(db);
  await adminUserStore.backfillUserIds(db);
  // Roles live in MongoDB and are edited at runtime: only missing defaults are inserted, existing roles are
  // never overwritten.
  return roleStore.insertMissingRoles(db, DEFAULT_ROLES);
}

/** Create the first super admin only when bootstrap mode is 'env' and none exists. */
export async function seedSuperAdmin(db, settings, { hasher = defaultHasher } = {}) {
  if (settings.superadminBootstrapMode.trim().toLowerCase() !== 'env') return false;
  if (await adminUserStore.existsWithRole(db, SUPER_ADMIN_ROLE)) return false;
  try {
    const passwordHash = await hasher.hash(settings.superadminPassword);
    await adminUserStore.createUser(db, {
      username: settings.superadminUsername.trim(), passwordHash, role: SUPER_ADMIN_ROLE,
    });
  } catch (err) {
    throw new StartupError(`Cannot create super admin: ${err.message}`);
  }
  logger.info(`Super admin '${settings.superadminUsername}' created from environment`);
  return true;
}

export async function prepareRuntimeStorage(settings) {
  try {
    for (const dir of [settings.runtimeDir, settings.staticDir, settings.mediaDir, settings.ttsCacheDir]) {
      await fs.mkdir(dir, { recursive: true });
    }
  } catch (err) {
    throw new StartupError(`Cannot prepare runtime storage: ${err.message}`);
  }
}

export async function runSeeding(db, settings, options = {}) {
  await seedRoles(db);
  await seedSuperAdmin(db, settings, options);
  await prepareRuntimeStorage(settings);
}
