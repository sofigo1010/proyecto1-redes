// src/tools/audit_site.js
// Tool MCP: audit_site
// Input:  { url: string }
// Output: {
//   overallPass: boolean,
//   overallScore: number (0–1) ó 0–100 según tu consumidor; aquí 0–1 para API MCP,
//   pages: [{
//     type: 'privacy'|'terms'|'faq',
//     foundAt?: string,
//     pass: boolean,
//     similarity: number,     // 0–100
//     sectionsFound?: string[],
//     sectionsMissing?: string[],
//     typos?: string[],
//     typoRate?: number,      // 0–1
//     headings?: string[],
//     qaCount?: number,       // sólo faq
//     rawTextLength?: number,
//     notes?: string[],
//     error?: string
//   }]
// }
//
// Nota: Mantiene la lógica 1:1 con el diseño del endpoint previo:
//  - Descubre candidatos por tails + <a href> en el home.
//  - Hace fetch con timeout/UA/limit.
//  - Scoring por tipo: TF-IDF/coseno vs templates (PDF), secciones y spellcheck.
//  - Umbrales por tipo (PP/TOS duros, FAQ suave).
//
// Importante: devolvemos overallScore en 0–1 (normalizado). Si quieres 0–100,
// simplemente multiplica por 100 en el consumidor.

import { loadEnvConfig } from '../config/env.js';
import { fetchHtml } from '../lib/net/fetchWithTimeout.js';
import { resolveCandidates } from '../lib/net/resolveCandidates.js';
import { scoreHtml } from '../lib/audit/scorer.js';
import { getSimilarityThreshold } from '../lib/audit/thresholds.js';

const TYPES = /** @type {const} */ (['privacy', 'terms', 'faq']);

// ---- Helpers para tails configurables por ENV (prepend/append) ----
function envList(name) {
  return (process.env[name] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function getTails(kind, defaults) {
  const pre = envList(`BEVSTACK_AUDITOR_${kind}_TAILS_PREPEND`);
  const app = envList(`BEVSTACK_AUDITOR_${kind}_TAILS_APPEND`);
  const norm = (s) => s.replace(/^\/+/, '');
  return [...pre.map(norm), ...defaults.map(norm), ...app.map(norm)];
}

// ---- Tolerancia de secciones faltantes por tipo (configurable por ENV) ----
function getMissingAllowance(type, env) {
  const fromEnv = (k, dflt) => {
    const v = Number(process.env[k] ?? env?.[k] ?? dflt);
    return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : dflt;
  };
  if (type === 'privacy') return fromEnv('BEVSTACK_ALLOW_MISSING_PRIVACY', 1);
  if (type === 'terms')   return fromEnv('BEVSTACK_ALLOW_MISSING_TERMS', 2);
  if (type === 'faq')     return fromEnv('BEVSTACK_ALLOW_MISSING_FAQ', 0);
  return 0;
}

/**
 * @param {{ url:string }} args
 * @param {{ log?:(level:string,...args:any[])=>void }} ctx
 */
export default async function auditSiteTool(args, { log }) {
  const url = sanitizeUrl(args?.url);
  if (!url) {
    return {
      overallPass: false,
      overallScore: 0,
      pages: TYPES.map((type) => ({
        type,
        pass: false,
        similarity: 0,
        error: 'Invalid or unsupported URL',
      })),
    };
  }

  const env = loadEnvConfig();

  // ---- Tails por tipo (Shopify-friendly) + ENV overrides ----
  // Evitamos tails genéricos como "policy/policies" que llevan a shipping/refund.
  const TAILS = {
    privacy: getTails('PRIVACY', [
      'policies/privacy-policy',   // Shopify
      'legal/privacy',
      'privacy-policy',
      'privacy',
    ]),
    terms: getTails('TERMS', [
      'policies/terms-of-service', // Shopify
      'legal/terms',
      'terms-of-service',
      'terms',
    ]),
    faq: getTails('FAQ', [
      'faq', 'faqs', 'help', 'support',
    ]),
  };

  // 1) Derivar origin del sitio
  let origin = '';
  try {
    const u = new URL(url);
    origin = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/`;
  } catch {
    return {
      overallPass: false,
      overallScore: 0,
      pages: TYPES.map((type) => ({
        type,
        pass: false,
        similarity: 0,
        error: 'Malformed URL',
      })),
    };
  }

  // 2) Descargar el home (podría fallar y seguimos con tails directos)
  let homeHtml = '';
  try {
    const { text } = await fetchHtml(url, {
      timeoutMs: env.TIMEOUT_MS,
      userAgent: env.USER_AGENT,
      maxBytes: env.MAX_HTML_SIZE_BYTES,
      retries: env.FETCH_RETRIES ?? 2,
    });
    homeHtml = text || '';
  } catch (err) {
    log?.('warn', 'audit_site: fetch home failed:', err?.message || err);
  }

  // 3) Resolver candidatos por tipo (mismo host por defecto)
  //    Usamos TAILS locales (Shopify-friendly) para evitar falsos positivos.
  const byType = resolveCandidates(
    origin,
    homeHtml,
    { CANDIDATE_TAILS: TAILS },
    { sameHostOnly: true }
  );

  // 4) Auditar cada tipo (secuencial, con early-stop por mejor candidato)
  /** @type {Array<{
   * type:'privacy'|'terms'|'faq',
   * foundAt?:string,
   * pass:boolean,
   * similarity:number,
   * sectionsFound?:string[],
   * sectionsMissing?:string[],
   * typos?:string[],
   * typoRate?:number,
   * headings?:string[],
   * qaCount?:number,
   * rawTextLength?:number,
   * notes?:string[],
   * error?:string
   * }>} */
  const pages = [];

  for (const type of TYPES) {
    const result = await auditOneType(type, byType[type], env, log);
    pages.push(result);
  }

  // 5) Agregados globales
  const sims = pages.map(p => p.similarity || 0);
  const overallScorePct = sims.length ? Math.round(sims.reduce((a, b) => a + b, 0) / sims.length) : 0;

  // Política de pase global:
  //  - Deben pasar privacy y terms.
  //  - FAQ es laxa; si falla, NO bloquea el pase global.
  const privacyPass = pages.find(p => p.type === 'privacy')?.pass ?? false;
  const termsPass   = pages.find(p => p.type === 'terms')?.pass ?? false;

  const overallPass = !!(privacyPass && termsPass);

  // Normalizamos overallScore en 0–1 para MCP; si prefieres 0–100, ajusta aquí.
  const overallScore = clamp01(overallScorePct / 100);

  return {
    overallPass,
    overallScore,
    pages,
  };
}

/**
 * Audita un tipo con su lista de candidatos. Intenta del primero al último,
 * guardando el mejor por similarity (aunque el primero que pase umbral corta temprano).
 * @param {'privacy'|'terms'|'faq'} type
 * @param {string[]} candidates
 * @param {*} env
 * @param {(level:string,...args:any[])=>void} [log]
 */
async function auditOneType(type, candidates, env, log) {
  const thr = getSimilarityThreshold(type, env);
  const missingAllowance = getMissingAllowance(type, env);

  let best = /** @type {ReturnType<typeof makeEmptyPage>} */ (makeEmptyPage(type));
  best.error = candidates?.length ? 'No candidate passed threshold' : 'No candidates found';

  // Intentamos cada candidato en orden
  for (const href of candidates || []) {
    let html = '';
    try {
      const { text } = await fetchHtml(href, {
        timeoutMs: env.TIMEOUT_MS,
        userAgent: env.userAgent ?? env.USER_AGENT, // por si tu env usa minúsculas
        maxBytes: env.MAX_HTML_SIZE_BYTES,
        retries: env.FETCH_RETRIES ?? 2,
      });
      html = text || '';
    } catch (err) {
      log?.('warn', `audit_site[${type}]: fetch failed for ${href}:`, err?.message || err);
      continue;
    }

    // Scoring del HTML
    let metrics;
    try {
      metrics = await scoreHtml(type, html, env);
    } catch (err) {
      log?.('warn', `audit_site[${type}]: scoring failed for ${href}:`, err?.message || err);
      continue;
    }

    const missingCount = Array.isArray(metrics.sectionsMissing) ? metrics.sectionsMissing.length : 0;
    const passComputed = (metrics.similarity >= thr) && (missingCount <= missingAllowance);

    const page = {
      type,
      foundAt: href,
      pass: passComputed,
      similarity: clampPct(metrics.similarity),
      sectionsFound: metrics.sectionsFound || [],
      sectionsMissing: metrics.sectionsMissing || [],
      typos: metrics.typos || [],
      typoRate: clamp01(metrics.typoRate || 0),
      headings: metrics.headings || [],
      qaCount: metrics.qaCount || (type === 'faq' ? 0 : undefined),
      rawTextLength: metrics.rawTextLength || 0,
      notes: metrics.notes || [],
    };

    // Actualizar mejor si corresponde
    if (!best.foundAt || page.similarity > (best.similarity || 0)) {
      best = { ...page, error: undefined };
    }

    // Early stop si supera claramente el umbral y cumple tolerancia
    if (passComputed) {
      return { ...page, error: undefined };
    }
  }

  // Si ninguno pasó, devolvemos el mejor intento (o vacío)
  return best;
}

function makeEmptyPage(type) {
  return {
    type,
    pass: false,
    similarity: 0,
    sectionsFound: [],
    sectionsMissing: [],
    typos: [],
    typoRate: 0,
    headings: [],
    qaCount: type === 'faq' ? 0 : undefined,
    rawTextLength: 0,
    notes: [],
  };
}

function sanitizeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}