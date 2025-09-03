import { DEFAULTS } from './defaults.js';

function numEnv(name, { min = -Infinity, max = Infinity } = {}) {
  const v = process.env[name];
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (n < min || n > max) return undefined;
  return n;
}

function boolEnv(name) {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (!v) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

function strEnv(name) {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

function jsonEnv(name) {
  const v = process.env[name];
  if (!v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

function listEnv(name) {
  const v = process.env[name];
  if (!v) return undefined;
  return v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Construye la configuración final (DEFAULTS + overrides por ENV).
 * ENV soportados (coinciden con mcp.manifest.json):
 *  - BEVSTACK_AUDITOR_TIMEOUT_MS (número)
 *  - BEVSTACK_AUDITOR_UA (string)
 *  - BEVSTACK_AUDITOR_PASS_THRESHOLD (0–100)
 *  - BEVSTACK_AUDITOR_FAQ_SOFT_PASS (0–100)
 * Extras útiles:
 *  - BEVSTACK_AUDITOR_MAX_HTML_BYTES (número)
 *  - BEVSTACK_AUDITOR_ENABLE_SPELLCHECK (boolean)
 *  - BEVSTACK_AUDITOR_SPELL_WHITELIST_APPEND ("foo,bar,baz")
 *  - BEVSTACK_AUDITOR_TAILS_JSON (JSON con forma de DEFAULTS.CANDIDATE_TAILS)
 *  - BEVSTACK_AUDITOR_REQUIRED_SECTIONS_JSON (JSON con forma de DEFAULTS.REQUIRED_SECTIONS)
 */
export function loadEnvConfig() {
  const overrides = {
    TIMEOUT_MS: numEnv('BEVSTACK_AUDITOR_TIMEOUT_MS', { min: 1 }),
    USER_AGENT: strEnv('BEVSTACK_AUDITOR_UA'),
    PASS_THRESHOLD: numEnv('BEVSTACK_AUDITOR_PASS_THRESHOLD', { min: 0, max: 100 }),
    FAQ_SOFT_PASS: numEnv('BEVSTACK_AUDITOR_FAQ_SOFT_PASS', { min: 0, max: 100 }),
    MAX_HTML_SIZE_BYTES: numEnv('BEVSTACK_AUDITOR_MAX_HTML_BYTES', { min: 10_000 }),

    ENABLE_SPELLCHECK: boolEnv('BEVSTACK_AUDITOR_ENABLE_SPELLCHECK'),
  };

  const tailsJson = jsonEnv('BEVSTACK_AUDITOR_TAILS_JSON');
  const requiredSectionsJson = jsonEnv('BEVSTACK_AUDITOR_REQUIRED_SECTIONS_JSON');
  const whitelistAppend = listEnv('BEVSTACK_AUDITOR_SPELL_WHITELIST_APPEND');

  const CANDIDATE_TAILS =
    tailsJson && typeof tailsJson === 'object'
      ? { ...DEFAULTS.CANDIDATE_TAILS, ...tailsJson }
      : DEFAULTS.CANDIDATE_TAILS;

  const REQUIRED_SECTIONS =
    requiredSectionsJson && typeof requiredSectionsJson === 'object'
      ? { ...DEFAULTS.REQUIRED_SECTIONS, ...requiredSectionsJson }
      : DEFAULTS.REQUIRED_SECTIONS;

  const SPELL_WHITELIST = Array.isArray(whitelistAppend) && whitelistAppend.length
    ? [...DEFAULTS.SPELL_WHITELIST, ...whitelistAppend]
    : DEFAULTS.SPELL_WHITELIST;

  // Ensamblar config final con fallback a DEFAULTS
  const cfg = {
    ...DEFAULTS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined)
    ),
    CANDIDATE_TAILS,
    REQUIRED_SECTIONS,
    SPELL_WHITELIST,
  };

  return Object.freeze(cfg);
}

export default loadEnvConfig;