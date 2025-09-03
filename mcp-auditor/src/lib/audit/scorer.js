// Scoring por página (privacy/terms/faq):
//  - HTML -> texto plano (htmlToPlain) + headings (extractHeadings)
//  - Similaridad 0–100 vs templates PDF (PP/TOS/CS) con TF-IDF/coseno
//  - Secciones requeridas por tipo (requiredSections)
//  - Spellcheck tolerante (nspell) con whitelist
//  - Decisión de pase/fail según thresholds por tipo
//
// Exporta:
//  - pickTemplatesFor(type) -> string[]
//  - scorePlain(type, text, cfg) -> métricas sin headings
//  - scoreHtml(type, html, cfg)  -> métricas + headings

import { htmlToPlain } from '../sections/htmlToPlain.js';
import { extractHeadings } from '../sections/extractHeadings.js';
import { getRequiredSections, findSectionsInText } from './requiredSections.js';
import { loadTemplatePack } from '../match/templateMatcher.js';
import { evaluatePagePass } from './thresholds.js';
import { spellcheckText } from '../spell/spellcheck.js';
import { loadEnvConfig } from '../../config/env.js';

/** Mapea tipo -> templates PDF a usar (por nombre de archivo en assets/templates). */
export function pickTemplatesFor(type) {
  switch (type) {
    case 'privacy': return ['PP.pdf'];
    case 'terms':   return ['TOS.pdf'];
    case 'faq':     return ['CS.pdf'];
    default:        return ['PP.pdf', 'TOS.pdf', 'CS.pdf'];
  }
}

/**
 * Métricas sobre texto plano (sin headings).
 * @param {'privacy'|'terms'|'faq'} type
 * @param {string} text
 * @param {*} [cfg]  Config cargada; si se omite, se usa loadEnvConfig()
 * @returns {Promise<{
 *   similarity:number,
 *   sectionsFound:string[],
 *   sectionsMissing:string[],
 *   typos:string[],
 *   typoRate:number,
 *   qaCount:number,
 *   pass:boolean,
 *   notes:string[],
 *   rawTextLength:number
 * }>}
 */
export async function scorePlain(type, text, cfg) {
  const env = cfg || loadEnvConfig();
  const plain = String(text || '');
  const rawTextLength = plain.length;

  // 1) Similaridad contra templates del tipo
  const names = pickTemplatesFor(type);
  const pack = await loadTemplatePack(names);
  const { labeled } = await import('../match/templateMatcher.js').then(m => ({
    labeled: m.matchTextToTemplates(plain, pack).labeled
  }));
  const similarity = Math.max(0, Math.min(100,
    Math.round((labeled[0]?.score ?? 0))
  ));

  // 2) Secciones requeridas
  const req = getRequiredSections(type, env);
  const { found: sectionsFound, missing: sectionsMissing } = findSectionsInText(plain, req);

  // 3) Spellcheck (respetando whitelist y enable)
  const enableSpell = env.ENABLE_SPELLCHECK !== false;
  const { typos, typoRate } = await spellcheckText(plain, {
    enable: enableSpell,
    whitelist: env.SPELL_WHITELIST || [],
  });

  // 4) QA count (solo para faq)
  const qaCount = type === 'faq' ? countFaqPairs(plain) : 0;

  // 5) Decisión de pase según thresholds
  const { pass, notes } = evaluatePagePass(type, {
    similarity,
    sectionsMissingCount: sectionsMissing.length,
    typoRate,
  }, env);

  return {
    similarity,
    sectionsFound,
    sectionsMissing,
    typos,
    typoRate,
    qaCount,
    pass,
    notes,
    rawTextLength,
  };
}

/**
 * Métricas completas desde HTML:
 *  - Aplica htmlToPlain + extractHeadings
 *  - Llama a scorePlain para el resto
 * @param {'privacy'|'terms'|'faq'} type
 * @param {string} html
 * @param {*} [cfg]
 * @returns {Promise<{
 *   similarity:number,
 *   sectionsFound:string[],
 *   sectionsMissing:string[],
 *   typos:string[],
 *   typoRate:number,
 *   qaCount:number,
 *   pass:boolean,
 *   notes:string[],
 *   headings:string[],
 *   rawTextLength:number
 * }>}
 */
export async function scoreHtml(type, html, cfg) {
  const env = cfg || loadEnvConfig();

  const headings = extractHeadings(html || '', {
    minLevel: 1,
    maxLevel: 3,
    dedupe: true,
    maxItems: 300,
    includeTitle: true,
  });

  const plain = htmlToPlain(html || '', {
    keepTitle: true,
    maxChars: env.MAX_HTML_SIZE_BYTES || 2_000_000,
  });

  const base = await scorePlain(type, plain, env);

  return {
    ...base,
    headings,
  };
}

/**
 * Cuenta pares Q/A en texto plano de FAQ.
 * Heurística simple:
 *  - Cuenta líneas/párrafos con "?" que van seguidos por un bloque de respuesta
 *    (línea o párrafo de ≥ 20 caracteres).
 *  - Además, detecta prefijos "Q:" / "A:".
 * @param {string} text
 * @returns {number}
 */
export function countFaqPairs(text) {
  if (!text || typeof text !== 'string') return 0;

  const paragraphs = text
    .split(/\n{2,}/g)        // párrafos por doble salto
    .map(s => s.trim())
    .filter(Boolean);

  let count = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const next = paragraphs[i + 1] || '';
    const isQ = /(^|\s)(q:|question:)/i.test(p) || /[?!]\s*$/.test(p) || /\?$/.test(p);
    const isA = /(^|\s)(a:|answer:)/i.test(next) || (next.length >= 20 && !/[?]{2,}/.test(next));

    if (isQ && isA) count++;
  }

  // fallback adicional: contar "Q:" emparejados con algún "A:" más adelante
  if (count === 0) {
    const qs = paragraphs.filter(p => /(^|\s)(q:|question:)/i.test(p)).length;
    const as = paragraphs.filter(p => /(^|\s)(a:|answer:)/i.test(p)).length;
    count = Math.min(qs, as);
  }

  return count;
}

export default {
  pickTemplatesFor,
  scorePlain,
  scoreHtml,
  countFaqPairs,
};