import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Asegura que cualquier entrada sea una ruta de FS válida (no URL http)
function toFsPath(p) {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object' && 'protocol' in p) {
    // WHATWG URL
    if (p.protocol === 'file:') return fileURLToPath(p);
    throw new Error(`Expected a filesystem path, got non-file URL: ${p.href || String(p)}`);
  }
  return String(p);
}

// Import robusto de pdf-parse (algunos setups requieren el entry real)
async function importPdfParse() {
  try {
    const mod = await import('pdf-parse');
    return mod && (mod.default || mod);
  } catch {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    return mod && (mod.default || mod);
  }
}


async function readPdfToText(absPathInput) {
  const pdfParse = await importPdfParse();

  // normaliza a ruta de FS
  const absPath = toFsPath(absPathInput);

  // 1) existencia
  if (!fsSync.existsSync(absPath)) {
    throw new Error(`Template PDF not found at path: ${absPath}`);
  }

  // 2) tamaño > 0
  const stat = await fs.stat(absPath);
  if (!stat || stat.size === 0) {
    throw new Error(`Template PDF is empty (0 bytes): ${absPath}`);
  }

  // 3) leer buffer
  const data = await fs.readFile(absPath);
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error(`Template PDF could not be read as a Buffer: ${absPath}`);
  }

  // 4) parsear
  const parsed = await pdfParse(data);
  const text = (parsed?.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) {
    throw new Error(`Template PDF returned empty text after parsing: ${absPath}`);
  }
  return text;
}

function tokenize(text) {
  return (text || '').split(/[^a-z0-9]+/gi).filter(Boolean);
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function buildVocab(docFreqs) {
  const vocab = new Map();
  for (const df of docFreqs) {
    for (const k of df.keys()) vocab.set(k, (vocab.get(k) || 0) + 1);
  }
  return vocab;
}

function tfidfVector(tfMap, vocab, docCount) {
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
 * Carga los 3 templates desde PDFs (las rutas pueden ser relativas a la raíz del proyecto).
 * Loguea rutas y tamaños para debug.
 * @param {{privacy:string, terms:string, faq:string}} paths
 */
export async function loadTemplatePack(paths) {
  const root = process.cwd();
  const resolveMaybeAbs = (p) => (path.isAbsolute(p) ? p : path.join(root, p));
  const resolved = {
    privacy: resolveMaybeAbs(paths.privacy),
    terms:   resolveMaybeAbs(paths.terms),
    faq:     resolveMaybeAbs(paths.faq),
  };

  // debug: rutas y tamaños
  const sizes = {};
  for (const [k, p] of Object.entries(resolved)) {
    const fsPath = toFsPath(p);
    try {
      const s = fsSync.existsSync(fsPath) ? fsSync.statSync(fsPath)?.size : -1;
      sizes[k] = s;
    } catch {
      sizes[k] = -1;
    }
  }
  console.log('[templates] resolved paths:', resolved);
  console.log('[templates] file sizes (bytes):', sizes);

  try {
    const [privacy, terms, faq] = await Promise.all([
      readPdfToText(resolved.privacy),
      readPdfToText(resolved.terms),
      readPdfToText(resolved.faq),
    ]);
    return { privacy, terms, faq };
  } catch (err) {
    const hint =
      `Resolved template paths:\n` +
      ` - privacy: ${resolved.privacy}\n` +
      ` - terms:   ${resolved.terms}\n` +
      ` - faq:     ${resolved.faq}\n` +
      `File sizes: ${JSON.stringify(sizes)}`;
    const msg = err && err.message ? `${err.message}\n${hint}` : `Failed to load templates.\n${hint}`;
    throw new Error(msg);
  }
}


export function similarityToTemplate(pageText, templateText) {
  const t1 = tokenize(pageText);
  const t2 = tokenize(templateText);
  if (!t1.length || !t2.length) return 0;

  const tf1 = termFreq(t1);
  const tf2 = termFreq(t2);
  const vocab = buildVocab([tf1, tf2]);

  const v1 = tfidfVector(tf1, vocab, 2);
  const v2 = tfidfVector(tf2, vocab, 2);

  return Math.round(cosineSim(v1, v2) * 100);
}


export function scoreAgainstPack(templatePack, siteTexts) {
  const out = {};
  for (const type of /** @type {const} */ (['privacy', 'terms', 'faq'])) {
    const siteText = siteTexts[type] || '';
    const tplText  = templatePack[type] || '';
    out[type] = { similarity: similarityToTemplate(siteText, tplText) };
  }
  return out;
}