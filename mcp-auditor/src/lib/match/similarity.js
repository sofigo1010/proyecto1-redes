// src/lib/match/similarity.js
// TF-IDF + coseno con normalización L2.
// Nota: devolvemos similitud en 0–100 (porcentaje), igual que tu API.

import { tokenize, termFreq, termSet, buildVocab, calcDocFreq } from './tokenize.js';

/**
 * Calcula IDF con smoothing: idf = log((N + 1) / (df + 1)) + 1
 * @param {number} N  # documentos
 * @param {number} df frecuencia documental del término
 */
export function idfOf(N, df) {
  return Math.log((N + 1) / (df + 1)) + 1;
}

/**
 * Construye un "workspace" TF-IDF (vocab + idf) a partir de documentos tokenizados.
 * @param {string[][]} docsTokens  lista de docs como arrays de tokens
 * @returns {{ vocab:string[], idf:Map<string, number> }}
 */
export function buildWorkspace(docsTokens) {
  const docSets = docsTokens.map(termSet);
  const df = calcDocFreq(docSets);
  const vocab = buildVocab(df); // ordenado y estable
  const N = docsTokens.length;

  const idf = new Map();
  for (const term of vocab) idf.set(term, idfOf(N, df.get(term) || 0));

  return { vocab, idf };
}

/**
 * Vectoriza un documento (tokens) a espacio TF-IDF y normaliza L2.
 * @param {string[]} tokens
 * @param {{ vocab:string[], idf:Map<string,number> }} ws
 * @returns {Float64Array} vector normalizado
 */
export function tfidfVector(tokens, ws) {
  const tf = termFreq(tokens);
  const v = new Float64Array(ws.vocab.length);
  for (let i = 0; i < ws.vocab.length; i++) {
    const term = ws.vocab[i];
    const tfv = tf.get(term) || 0;
    const idfv = ws.idf.get(term) || 0;
    v[i] = tfv * idfv;
  }
  // L2 norm
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/**
 * Cosine similarity entre dos vectores L2-normalizados → [0,1]
 * @param {Float64Array} a
 * @param {Float64Array} b
 */
export function cosineSim(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  // a y b ya están normalizados; dot está en [0,1] por construcción
  if (!Number.isFinite(dot) || dot < 0) return 0;
  if (dot > 1) return 1;
  return dot;
}

/**
 * Similitud TF-IDF (0–100) desde dos textos planos.
 * @param {string} textA
 * @param {string} textB
 * @param {{ minLen?: number }} [opts]  opciones de tokenización
 */
export function similarityFromTexts(textA, textB, opts = {}) {
  const tokA = tokenize(textA || '', { minLen: opts.minLen });
  const tokB = tokenize(textB || '', { minLen: opts.minLen });

  // Workspace con ambos documentos
  const ws = buildWorkspace([tokA, tokB]);

  const va = tfidfVector(tokA, ws);
  const vb = tfidfVector(tokB, ws);

  const sim01 = cosineSim(va, vb);
  return toPct(sim01); // 0–100
}

/**
 * Similitud TF-IDF (0–100) de un texto vs. múltiples plantillas.
 * Devuelve el mejor match.
 * @param {string} text
 * @param {string[]} templates
 * @param {{ minLen?: number }} [opts]
 * @returns {{ best:number, byTemplate:number[] }}
 */
export function similarityAgainstTemplates(text, templates, opts = {}) {
  const target = tokenize(text || '', { minLen: opts.minLen });
  const templTokens = templates.map(t => tokenize(t || '', { minLen: opts.minLen }));

  // Workspace con target + todas las plantillas
  const ws = buildWorkspace([target, ...templTokens]);

  const vTarget = tfidfVector(target, ws);
  const scores = [];
  let best = 0;

  for (const tt of templTokens) {
    const v = tfidfVector(tt, ws);
    const s = toPct(cosineSim(vTarget, v));
    scores.push(s);
    if (s > best) best = s;
  }

  return { best, byTemplate: scores };
}

function toPct(x01) {
  const pct = Math.round(Math.max(0, Math.min(1, x01)) * 100);
  return pct;
}

export default {
  idfOf,
  buildWorkspace,
  tfidfVector,
  cosineSim,
  similarityFromTexts,
  similarityAgainstTemplates,
};