// src/lib/templateMatcher.js
// PDF -> text + TF-IDF cosine similarity for Privacy / Terms / FAQ (EN)
// Next step will wire this into /api/prueba and add section checks + spellcheck.
//
// ⬇️ Requires: `npm i pdf-parse`
// Works in Next.js Route Handlers (Node runtime)

import fs from 'node:fs/promises';
import path from 'node:path';

async function readPdfToText(absPath) {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await fs.readFile(absPath);
  const parsed = await pdfParse(data);
  // normalize whitespace + lowercase for stable scoring
  return (parsed.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(text) {
  // basic tokenization; keep letters/numbers, drop punctuation
  return text.split(/[^a-z0-9]+/g).filter(Boolean);
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function buildVocab(docFreqs) {
  // docFreqs: array<Map> of termFreqs
  const vocab = new Map();
  for (const df of docFreqs) {
    for (const k of df.keys()) vocab.set(k, (vocab.get(k) || 0) + 1);
  }
  return vocab;
}

function tfidfVector(tfMap, vocab, docCount) {
  // log-tf * idf; idf = ln( (N + 1) / (df + 1) ) + 1
  const vec = new Map();
  for (const [term, f] of tfMap.entries()) {
    const df = vocab.get(term) || 0;
    const idf = Math.log((docCount + 1) / (df + 1)) + 1;
    const w = (1 + Math.log(f)) * idf;
    vec.set(term, w);
  }
  return vec;
}

function cosineSim(vecA, vecB) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set([...vecA.keys(), ...vecB.keys()]);
  for (const k of keys) {
    const a = vecA.get(k) || 0;
    const b = vecB.get(k) || 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Builds a template pack by loading PDFs (absolute or relative to project root).
 * @param {{privacy:string, terms:string, faq:string}} paths
 * @returns {Promise<{privacy:string, terms:string, faq:string}>}
 */
export async function loadTemplatePack(paths) {
  const root = process.cwd();
  const resolveMaybeAbs = (p) => (path.isAbsolute(p) ? p : path.join(root, p));
  const [privacy, terms, faq] = await Promise.all([
    readPdfToText(resolveMaybeAbs(paths.privacy)),
    readPdfToText(resolveMaybeAbs(paths.terms)),
    readPdfToText(resolveMaybeAbs(paths.faq)),
  ]);
  return { privacy, terms, faq };
}

/**
 * Computes cosine similarity (%) between pageText and a given templateText using TF-IDF.
 * @param {string} pageText - normalized plain text from website (lowercase recommended)
 * @param {string} templateText - text extracted from PDF template
 * @returns {number} similarity in [0..100]
 */
export function similarityToTemplate(pageText, templateText) {
  const t1 = tokenize(pageText.toLowerCase());
  const t2 = tokenize(templateText.toLowerCase());

  // Build document frequency (2 docs)
  const tf1 = termFreq(t1);
  const tf2 = termFreq(t2);
  const vocab = buildVocab([tf1, tf2]);

  // TF-IDF vectors
  const v1 = tfidfVector(tf1, vocab, 2);
  const v2 = tfidfVector(tf2, vocab, 2);

  return Math.round(cosineSim(v1, v2) * 100);
}

/**
 * High-level scoring against the 3 templates.
 * @param {{privacy:string, terms:string, faq:string}} templatePack
 * @param {{privacy?:string, terms?:string, faq?:string}} siteTexts - extracted texts per page
 * @returns {Record<"privacy"|"terms"|"faq",{similarity:number}>}
 */
export function scoreAgainstPack(templatePack, siteTexts) {
  const out = {};
  for (const type of /** @type {const} */ (['privacy', 'terms', 'faq'])) {
    const siteText = (siteTexts[type] || '').toLowerCase();
    const tplText = (templatePack[type] || '').toLowerCase();
    out[type] = {
      similarity: siteText && tplText ? similarityToTemplate(siteText, tplText) : 0
    };
  }
  return out;
}