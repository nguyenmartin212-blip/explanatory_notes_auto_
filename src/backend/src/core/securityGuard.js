// Step 1 — Security & Bootstrap Guard.
// Runs before any connection is opened. Outside development, weak or missing secrets and unsafe
// super-admin bootstrap settings abort the startup.
import { StartupError } from './errors.js';

const SECRET_ENV_NAMES = {
  JWT_SECRET: 'jwtSecret',
  REFRESH_TOKEN_SECRET: 'refreshTokenSecret',
  SECRET_KEY: 'secretKey',
};
export const MIN_SECRET_LENGTH = 32;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_MARKERS = ['changeme', 'change-me', 'change_me', 'secret', 'example', 'default', 'password'];
const BOOTSTRAP_MODES = ['disabled', 'env'];

function secretProblems(settings) {
  const problems = [];
  const values = {};
  for (const [envName, attr] of Object.entries(SECRET_ENV_NAMES)) {
    const value = settings[attr];
    values[envName] = value;
    if (!value) problems.push(`${envName} is not set`);
    else if (value.length < MIN_SECRET_LENGTH) problems.push(`${envName} must be at least ${MIN_SECRET_LENGTH} characters`);
    else if (PLACEHOLDER_MARKERS.some((m) => value.toLowerCase().includes(m))) {
      problems.push(`${envName} looks like a placeholder value`);
    }
  }
  const nonEmpty = Object.values(values).filter(Boolean);
  if (new Set(nonEmpty).size !== nonEmpty.length) {
    problems.push('JWT_SECRET, REFRESH_TOKEN_SECRET and SECRET_KEY must all be different');
  }
  return problems;
}

function bootstrapProblems(settings) {
  const problems = [];
  const mode = settings.superadminBootstrapMode.trim().toLowerCase();
  if (!BOOTSTRAP_MODES.includes(mode)) {
    problems.push(`SUPERADMIN_BOOTSTRAP_MODE must be one of ${JSON.stringify([...BOOTSTRAP_MODES].sort())}, got '${mode}'`);
    return problems;
  }
  if (mode === 'env') {
    if (!settings.superadminUsername.trim()) problems.push('SUPERADMIN_USERNAME is required when SUPERADMIN_BOOTSTRAP_MODE=env');
    if (!settings.superadminPassword) problems.push('SUPERADMIN_PASSWORD is required when SUPERADMIN_BOOTSTRAP_MODE=env');
    else if (!settings.isDevelopment && settings.superadminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
      problems.push(`SUPERADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
    }
  }
  return problems;
}

export function validateSecurityConfig(settings) {
  let problems = [...bootstrapProblems(settings)];
  if (!settings.isDevelopment) problems = [...secretProblems(settings), ...problems];
  if (problems.length) {
    throw new StartupError('Security guard failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  }
}
