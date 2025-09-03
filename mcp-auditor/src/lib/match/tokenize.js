// Tokenizador minimalista para TF-IDF:
//  - Divide por cualquier carácter NO [a-z0-9] (case-insensitive).
//  - Filtra vacíos.
//  - Normaliza a minúsculas.
//  - Permite descartar tokens "muy cortos" (stop-noise) por longitud mínima.

const DEFAULT_MIN_LEN = 2;

/**
 * Tokeniza texto plano.
 * @param {string} text
 * @param {{ minLen?: number }} [opts]
 * @returns {string[]} tokens en minúsculas
 */
export function tokenize(text, opts = {}) {
  if (!text || typeof text !== 'string') return [];
  const minLen = Math.max(0, opts.minLen ?? DEFAULT_MIN_LEN);

  // Split por no-alfaNum (idéntico en espíritu a /[^a-z0-9]+/gi).
  const parts = text.split(/[^a-z0-9]+/gi);

  /** @type {string[]} */
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    const t = p.toLowerCase();
    if (t.length < minLen) continue;
    out.push(t);
  }
  return out;
}

/**
 * Frecuencia de términos (TF crudo).
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/**
 * Conjunto de términos presentes en una lista de tokens.
 * @param {string[]} tokens
 * @returns {Set<string>}
 */
export function termSet(tokens) {
  return new Set(tokens);
}

/**
 * Construye vocabulario ordenado a partir de DF (frecuencia documental).
 * @param {Map<string, number>} docFreqs  Mapa término -> #docs que lo contienen
 * @returns {string[]} vocab ordenado por término (estable)
 */
export function buildVocab(docFreqs) {
  return Array.from(docFreqs.keys()).sort();
}

/**
 * Calcula DF (document frequency) para N documentos.
 * @param {Array<Set<string>>} docSets lista de conjuntos de términos por doc
 * @returns {Map<string, number>} término -> df
 */
export function calcDocFreq(docSets) {
  const df = new Map();
  for (const s of docSets) {
    for (const t of s) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

export default {
  tokenize,
  termFreq,
  termSet,
  buildVocab,
  calcDocFreq,
};