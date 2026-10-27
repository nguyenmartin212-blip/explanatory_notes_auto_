import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(file = '.env') {
  // Node >= 20.12 / 21.7 has process.loadEnvFile; real environment variables win over the file.
  try {
    if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
  } catch {
    /* a broken .env must not crash before the security guard can report problems */
  }
}

const str = (env, key, def = '') => (env[key] === undefined ? def : String(env[key]));
const int = (env, key, def) => {
  const raw = env[key];
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number.parseInt(String(raw), 10);
  if (Number.isNaN(n)) throw new Error(`${key} must be an integer, got '${raw}'`);
  return n;
};
const float = (env, key, def) => {
  const raw = env[key];
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number.parseFloat(String(raw));
  if (Number.isNaN(n)) throw new Error(`${key} must be a number, got '${raw}'`);
  return n;
};
const optBool = (env, key) => {
  const raw = env[key];
  if (raw === undefined || String(raw).trim() === '') return null;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
};

/** Build the settings object. Property names are camelCase versions of the Python fields. */
export function loadSettings(env = process.env) {
  const appEnv = str(env, 'APP_ENV', 'development');
  const isDevelopment = ['development', 'dev', 'local'].includes(appEnv.trim().toLowerCase());
  const corsRaw = str(env, 'CORS_ALLOW_ORIGINS').trim() || (isDevelopment ? '*' : '');
  const resolvePath = (key, def) => path.resolve(str(env, key, def));

  return {
    appEnv,
    isDevelopment,
    port: int(env, 'PORT', 3000),

    // Secrets (validated by the security guard outside development)
    jwtSecret: str(env, 'JWT_SECRET'),
    refreshTokenSecret: str(env, 'REFRESH_TOKEN_SECRET'),
    secretKey: str(env, 'SECRET_KEY'),

    // disabled | env
    superadminBootstrapMode: str(env, 'SUPERADMIN_BOOTSTRAP_MODE', 'disabled'),
    superadminUsername: str(env, 'SUPERADMIN_USERNAME'),
    superadminPassword: str(env, 'SUPERADMIN_PASSWORD'),

    mongoUri: str(env, 'MONGO_URI', 'mongodb://localhost:27017/?replicaSet=rs0'),
    mongoDb: str(env, 'MONGO_DB', 'explanatory_notes'),
    mongoServerSelectionTimeoutMs: int(env, 'MONGO_SERVER_SELECTION_TIMEOUT_MS', 5000),
    redisUrl: str(env, 'REDIS_URL', 'redis://localhost:6379/0'),

    // local | none
    mediaStorageBackend: str(env, 'MEDIA_STORAGE_BACKEND', 'local'),
    mediaDir: resolvePath('MEDIA_DIR', './runtime/media'),
    runtimeDir: resolvePath('RUNTIME_DIR', './runtime'),
    staticDir: resolvePath('STATIC_DIR', './runtime/static'),

    audioTaskStaleSeconds: int(env, 'AUDIO_TASK_STALE_SECONDS', 900),
    maintenanceIntervalSeconds: int(env, 'MAINTENANCE_INTERVAL_SECONDS', 60),

    // Authentication & RBAC (Chapter 07)
    authCookieSecure: optBool(env, 'AUTH_COOKIE_SECURE'), // null: Secure outside development
    authCookieSamesite: str(env, 'AUTH_COOKIE_SAMESITE', 'lax'),
    authCookieDomain: str(env, 'AUTH_COOKIE_DOMAIN') || null,

    // Audio / TTS (Chapter 06)
    ttsCacheDir: resolvePath('TTS_CACHE_DIR', './runtime/tts-cache'),
    ttsTimeoutSeconds: int(env, 'TTS_TIMEOUT_SECONDS', 60),
    ttsMaxTextChars: int(env, 'TTS_MAX_TEXT_CHARS', 5000),
    audioMaxConcurrency: int(env, 'AUDIO_MAX_CONCURRENCY', 3),
    audioPollIntervalSeconds: float(env, 'AUDIO_POLL_INTERVAL_SECONDS', 2.0),
    audioSsePollSeconds: float(env, 'AUDIO_SSE_POLL_SECONDS', 1.0),
    mediaPublicPrefix: str(env, 'MEDIA_PUBLIC_PREFIX', '/media'),
    // Public base URL used to build absolute audio URLs (empty: taken from the request)
    publicBaseUrl: str(env, 'PUBLIC_BASE_URL'),

    // Browser clients (Expo web runs on another origin). "*" = any origin.
    corsAllowOrigins: str(env, 'CORS_ALLOW_ORIGINS'),
    corsOrigins: corsRaw.split(',').map((o) => o.trim()).filter(Boolean),

    // Localization & UI bundles (Chapter 08)
    localizationHotsetRadiusM: int(env, 'LOCALIZATION_HOTSET_RADIUS_M', 1500),
    localizationHotsetMaxPois: int(env, 'LOCALIZATION_HOTSET_MAX_POIS', 10),
    localizationHotsetRequired: int(env, 'LOCALIZATION_HOTSET_REQUIRED', 3),
    localizationTranslateConcurrency: int(env, 'LOCALIZATION_TRANSLATE_CONCURRENCY', 3),
    localizationQueueMax: int(env, 'LOCALIZATION_QUEUE_MAX', 1000),
    localizationOnDemandWaitSeconds: float(env, 'LOCALIZATION_ON_DEMAND_WAIT_SECONDS', 5.0),
    localizationFailureCooldownSeconds: int(env, 'LOCALIZATION_FAILURE_COOLDOWN_SECONDS', 60),
    localizationRateLimitRequests: int(env, 'LOCALIZATION_RATE_LIMIT_REQUESTS', 30),
    localizationRateLimitWindowSeconds: int(env, 'LOCALIZATION_RATE_LIMIT_WINDOW_SECONDS', 60),
    localizationWarmupCooldownSeconds: int(env, 'LOCALIZATION_WARMUP_COOLDOWN_SECONDS', 300),
    uiBundleLockSeconds: int(env, 'UI_BUNDLE_LOCK_SECONDS', 600),
    uiBundleFailureCooldownSeconds: int(env, 'UI_BUNDLE_FAILURE_COOLDOWN_SECONDS', 300),
  };
}

let cached = null;
export function getSettings() {
  if (!cached) {
    loadDotEnv();
    cached = loadSettings(process.env);
  }
  return cached;
}
export function resetSettingsCache() { cached = null; }
