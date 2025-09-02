// src/lib/spell/whitelist.js
// Wrapper para exponer la whitelist desde la config/env.
// Mantiene compatibilidad con imports que esperen este módulo.

import { loadEnvConfig } from '../../config/env.js';

/** Devuelve la whitelist efectiva (DEFAULTS + overrides por ENV). */
export function getWhitelist() {
  const env = loadEnvConfig();
  return Array.isArray(env.SPELL_WHITELIST) ? env.SPELL_WHITELIST : [];
}

export default getWhitelist();