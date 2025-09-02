// src/lib/sections/extractHeadings.js
// Extrae encabezados H1–H3 del HTML y los normaliza para reporte/auditoría.
//
// Reglas por defecto (alineadas a uso típico de auditoría):
//  - Niveles: H1..H3 (configurable con minLevel/maxLevel)
//  - Normaliza espacios (colapsa, trim)
//  - Filtra vacíos y encabezados con solo símbolos
//  - De-duplica preservando el orden
//  - Limita resultados (maxItems) para evitar explosiones

import { load } from 'cheerio';

/**
 * @typedef {Object} ExtractOpts
 * @property {number} [minLevel=1]     Nivel mínimo (1..6)
 * @property {number} [maxLevel=3]     Nivel máximo (1..6)
 * @property {boolean} [dedupe=true]   De-duplica preservando orden
 * @property {number} [maxItems=200]   Límite de encabezados
 * @property {boolean} [includeTitle=true] Incluir <title> como primer heading lógico si existe
 */

/**
 * Extrae headings del HTML.
 * @param {string} html
 * @param {ExtractOpts} [opts]
 * @returns {string[]}
 */
export function extractHeadings(html, opts = {}) {
  if (!html || typeof html !== 'string') return [];

  const minLevel = clampInt(opts.minLevel ?? 1, 1, 6);
  const maxLevel = clampInt(opts.maxLevel ?? 3, 1, 6);
  const dedupe = opts.dedupe ?? true;
  const maxItems = clampInt(opts.maxItems ?? 200, 1, 10_000);
  const includeTitle = opts.includeTitle ?? true;

  // ✅ usar la función importada "load" (no "cheerio.load")
  const $ = load(html, { decodeEntities: true, lowerCaseTags: true });

  /** @type {string[]} */
  const out = [];

  // Opcionalmente, tomar <title> como "heading 0" si está
  if (includeTitle) {
    const title = normalizeText(String($('title').first().text() || ''));
    if (isUseful(title)) out.push(title);
  }

  // Construye selector con niveles deseados
  const sel = buildHeadingSelector(minLevel, maxLevel);
  const nodes = $(sel);

  for (let i = 0; i < nodes.length && out.length < maxItems; i++) {
    const txt = normalizeText($(nodes[i]).text() || '');
    if (!isUseful(txt)) continue;
    out.push(txt);
  }

  if (dedupe) {
    return dedupePreserve(out).slice(0, maxItems);
  }
  return out.slice(0, maxItems);
}

function buildHeadingSelector(minL, maxL) {
  const parts = [];
  for (let l = minL; l <= maxL; l++) parts.push(`h${l}`);
  return parts.join(',');
}

function normalizeText(s) {
  return String(s)
    .replace(/\u00A0/g, ' ')     // NBSP -> espacio
    .replace(/\r/g, '\n')        // CR -> LF
    .replace(/[ \t]+/g, ' ')     // colapsar espacios/tabs
    .replace(/\n{2,}/g, '\n')    // colapsar múltiples saltos
    .replace(/[ \t]+\n/g, '\n')  // trailing space
    .replace(/\n[ \t]+/g, '\n')  // leading space
    .trim();
}

function isUseful(s) {
  if (!s) return false;
  // descartar si son solo símbolos/puntuación
  if (!/[A-Za-zÀ-ÿ0-9]/.test(s)) return false;
  // evitar headings excesivamente cortos tipo "." o "#"
  if (s.length < 2) return false;
  return true;
}

function dedupePreserve(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

export default extractHeadings;