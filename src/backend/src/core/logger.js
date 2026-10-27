// Tiny logger (no dependency). LOG_LEVEL=debug|info|warn|error (default info; silent in tests via LOG_LEVEL=silent).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = () => LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, args) {
  if (LEVELS[level] < threshold()) return;
  const stamp = new Date().toISOString();
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(`${stamp} ${level.toUpperCase()}`, ...args);
}

export const logger = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
  /** Like Python's logger.exception: message + the error's stack. */
  exception: (msg, err) => emit('error', [msg, err?.stack || err]),
};
