import { promisify } from 'node:util';

let nspellInstance = null;

async function getSpeller() {
  if (nspellInstance) return nspellInstance;

  const { default: nspell } = await import('nspell');
  const dict = await import('dictionary-en'); 
  const load = promisify(dict.default || dict);

  const { aff, dic } = await load({});
  nspellInstance = nspell(aff, dic);
  return nspellInstance;
}

function tokenize(text) {
  const tokens = text
    .replace(/\S+@\S+\.\S+/g, ' ')       // emails
    .replace(/https?:\/\/\S+/g, ' ')     // urls
    .split(/[^a-z0-9'’]+/i)
    .filter(Boolean);

  return tokens;
}

/**
 * Chequea ortografía en-US.
 * @param {string} text Texto en minúsculas preferentemente.
 * @param {{ whitelist?: string[], maxErrors?: number }} opts
 * @returns {Promise<Array<{word:string, suggestions:string[], index:number}>>}
 */
export async function spellcheckText(text, opts = {}) {
  const speller = await getSpeller();
  const whitelist = new Set((opts.whitelist || []).map(w => w.toLowerCase()));
  const maxErrors = typeof opts.maxErrors === 'number' ? opts.maxErrors : 200;

  const words = tokenize(text);
  const errors = [];
  let idx = 0;

  for (const w of words) {
    // Heurísticas para no marcar en falso positivo
    if (w.length <= 2) { idx++; continue; }                 // muy cortas
    if (/^\d+$/.test(w)) { idx++; continue; }               // números
    if (/^[a-z]'[a-z]$/i.test(w)) { idx++; continue; }      // contracciones simples
    if (whitelist.has(w.toLowerCase())) { idx++; continue; }

    if (!speller.correct(w)) {
      const suggestions = speller.suggest(w).slice(0, 3);
      errors.push({ word: w, suggestions, index: idx });
      if (errors.length >= maxErrors) break;
    }
    idx++;
  }

  return errors;
}

/**
 * Métrica simple de tasa de error.
 * @param {number} errorCount
 * @param {number} totalTokens
 * @returns {number} porcentaje 0..100
 */
export function typoRate(errorCount, totalTokens) {
  if (!totalTokens) return 0;
  return +(100 * (errorCount / totalTokens)).toFixed(2);
}