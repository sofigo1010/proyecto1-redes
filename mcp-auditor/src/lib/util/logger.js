// Logger simple: niveles, prefijos y redaction de claves sensibles.
// Escribe SIEMPRE a STDERR para no contaminar STDOUT (canal MCP).

const LEVELS = /** @type {const} */ (['error', 'warn', 'info', 'debug']);

/**
 * @typedef {('error'|'warn'|'info'|'debug')} Level
 */

/**
 * Crea un logger.
 * @param {{ level?: Level, prefix?: string, redactKeys?: string[] }} [opts]
 */
export function createLogger(opts = {}) {
  const level = normalizeLevel(opts.level ?? (process.env.LOG_LEVEL || 'info'));
  const prefix = opts.prefix ? String(opts.prefix) : '';
  const redactKeys = Array.isArray(opts.redactKeys) ? opts.redactKeys : [];

  function enabled(l) {
    return LEVELS.indexOf(l) <= LEVELS.indexOf(level);
  }

  function emit(l, args) {
    if (!enabled(l)) return;
    const ts = new Date().toISOString();
    const head = prefix ? `[${l}] ${ts} ${prefix}` : `[${l}] ${ts}`;
    const rendered = args.map(a => formatArg(a, redactKeys)).join(' ');
    // Siempre a STDERR
    process.stderr.write(`${head} ${rendered}\n`);
  }

  /** @type {(l:Level, ...args:any[])=>void} */
  function log(l, ...args) { emit(l, args); }

  /** Atajos */
  log.error = (...a) => emit('error', a);
  log.warn  = (...a) => emit('warn', a);
  log.info  = (...a) => emit('info', a);
  log.debug = (...a) => emit('debug', a);

  /** Crea un child logger con prefijo acumulado. */
  log.child = (childPrefix = '', childOpts = {}) =>
    createLogger({
      level,
      prefix: prefix ? `${prefix} ${childPrefix}` : String(childPrefix),
      redactKeys: childOpts.redactKeys || redactKeys,
    });

  /** Cambia el nivel en runtime (útil para depurar localmente). */
  log.setLevel = (l) => {
    const norm = normalizeLevel(l);
    if (norm) (/** @type {any} */(log))._level = norm;
  };

  // Exponer nivel efectivo (solo lectura)
  Object.defineProperty(log, 'level', {
    get: () => (/** @type {any} */(log))._level ?? level,
  });

  return log;
}

/** Normaliza nivel; vuelve a 'info' si no es válido. */
function normalizeLevel(l) {
  const s = String(l || '').toLowerCase();
  return LEVELS.includes(s) ? /** @type {any} */(s) : 'info';
}

/** Render seguro de valores y objetos, con redaction superficial. */
function formatArg(val, redactKeys) {
  if (val == null) return String(val);
  if (typeof val === 'string') return val;
  if (val instanceof Error) return val.stack || `${val.name}: ${val.message}`;

  if (typeof val === 'object') {
    try {
      const safe = shallowClone(val);
      for (const k of redactKeys) {
        if (k in safe) safe[k] = '***';
      }
      return JSON.stringify(safe);
    } catch {
      // fallback
      return Object.prototype.toString.call(val);
    }
  }
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function shallowClone(obj) {
  if (Array.isArray(obj)) return obj.slice();
  return { ...obj };
}

export default createLogger;