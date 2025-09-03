// Revisión ortográfica con nspell (EN) + whitelist. Tolerante a fallos.
// - Carga diccionario desde assets/dictionaries/{en_US.aff,en_US.dic}.
// - Si el diccionario no existe, continúa "silenciosamente" (sin typos).
// - Tokeniza con el mismo criterio del motor TF-IDF para coherencia.
// - Aplica whitelist y filtros básicos (emails, URLs, números).
//
// Exporta:
//   - getSpell(opts)
//   - spellcheckTokens(tokens, opts)
//   - spellcheckText(text, opts) -> { typos:string[], typoRate:number }

import fs from 'node:fs/promises';
import nspell from 'nspell';
import { resolveDict } from '../util/ensurePaths.js';
import { tokenize } from '../match/tokenize.js';

/** Cache del spell (por clave de diccionario) */
const SPELL_CACHE = new Map();

/**
 * Carga (o recupera) una instancia de nspell.
 * @param {{ dict?: 'en_US', whitelist?: string[] }} [opts]
 */
export async function getSpell(opts = {}) {
  const dictKey = opts.dict || 'en_US';
  const cacheKey = `${dictKey}|${(opts.whitelist || []).join(',')}`;

  if (SPELL_CACHE.has(cacheKey)) return SPELL_CACHE.get(cacheKey);

  try {
    const aff = await fs.readFile(await resolveDict(`${dictKey}.aff`), 'utf8');
    const dic = await fs.readFile(await resolveDict(`${dictKey}.dic`), 'utf8');
    const sp = nspell(aff, dic);

    // Aplica whitelist
    for (const w of opts.whitelist || []) {
      try { sp.add(w); } catch { /* noop */ }
    }
    SPELL_CACHE.set(cacheKey, sp);
    return sp;
  } catch {
    // Si no hay diccionarios, devuelve un "spell" nulo
    const nullSpell = {
      correct: () => true,
      add: () => {},
      suggest: () => [],
      __disabled: true,
    };
    SPELL_CACHE.set(cacheKey, nullSpell);
    return nullSpell;
  }
}

/** Heurísticas simples para ignorar tokens que no deben contarse como palabras. */
function shouldIgnoreToken(t) {
  if (!t) return true;
  // Emails / URLs / números puros
  if (/@/.test(t)) return true;
  if (/^[a-z]+:\/\//i.test(t)) return true;
  if (/^\d+([.,]\d+)*$/.test(t)) return true;
  // Tokens con guiones muy técnicos (p.ej., sku-123) -> opcionalmente ignorar
  if (/^[a-z0-9]+[-_][a-z0-9]+$/i.test(t)) return false; // contamos
  return false;
}

/**
 * Revisión ortográfica sobre tokens ya tokenizados.
 * @param {string[]} tokens
 * @param {{ whitelist?: string[], minLen?: number, dict?: 'en_US', enable?: boolean }} [opts]
 * @returns {Promise<string[]>} lista de typos (únicos, orden de aparición)
 */
export async function spellcheckTokens(tokens, opts = {}) {
  const enable = opts.enable ?? true;
  if (!enable || !Array.isArray(tokens) || tokens.length === 0) return [];

  const spell = await getSpell({ dict: opts.dict || 'en_US', whitelist: opts.whitelist || [] });
  if (spell.__disabled) return []; // sin dics => no marca typos

  const minLen = Math.max(2, opts.minLen ?? 3);
  const seen = new Set();
  const out = [];

  for (const raw of tokens) {
    const t = String(raw || '').trim();
    if (!t || t.length < minLen) continue;
    if (shouldIgnoreToken(t)) continue;

    // nspell espera minúsculas normalmente
    const w = t.toLowerCase();
    try {
      if (!spell.correct(w) && !seen.has(w)) {
        seen.add(w);
        out.push(w);
      }
    } catch {
      // Si nspell explota con algún término raro, lo ignora
      continue;
    }
  }
  return out;
}

/**
 * Revisión ortográfica directa desde texto.
 * @param {string} text
 * @param {{ whitelist?: string[], minLen?: number, dict?: 'en_US', enable?: boolean }} [opts]
 * @returns {Promise<{ typos:string[], typoRate:number }>}
 */
export async function spellcheckText(text, opts = {}) {
  if (!text || typeof text !== 'string') {
    return { typos: [], typoRate: 0 };
  }
  const tokens = tokenize(text, { minLen: 1 });
  const filtered = tokens.filter((t) => !shouldIgnoreToken(t));

  if (filtered.length === 0) {
    return { typos: [], typoRate: 0 };
  }

  const typos = await spellcheckTokens(filtered, opts);
  const typoRate = Math.max(0, Math.min(1, typos.length / filtered.length));
  return { typos, typoRate };
}

export default {
  getSpell,
  spellcheckTokens,
  spellcheckText,
};