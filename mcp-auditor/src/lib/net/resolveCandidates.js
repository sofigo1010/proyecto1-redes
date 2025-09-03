// Dada la URL base (origin) y el HTML del home, sugiere candidatos por tipo:
//  - Usa findCandidateLink() para hallar el primer enlace en el home que matchee algún tail.
//  - Siempre agrega como fallback los tails directos resueltos contra el origin.
//  - De-duplica, valida y (opcional) restringe al mismo host.

import { findCandidateLink } from './findCandidateLink.js';

/**
 * @typedef {Object} ResolveOpts
 * @property {boolean} [sameHostOnly=true]  Si true, filtra a mismo hostname que el origin.
 */

/**
 * @param {string} origin              Origin, p.ej. "https://acme.com" (puede venir con path: se normaliza al origin).
 * @param {string} homeHtml            HTML del home (puede ser vacío/null; en ese caso sólo se generan tails directos).
 * @param {{ CANDIDATE_TAILS: Record<'privacy'|'terms'|'faq', string[]> }} cfg  Config con tails por tipo.
 * @param {ResolveOpts} [opts]
 * @returns {{ privacy: string[], terms: string[], faq: string[] }}
 */
export function resolveCandidates(origin, homeHtml, cfg, opts = {}) {
  const sameHostOnly = opts.sameHostOnly ?? true;

  let base;
  try {
    // Asegura que sea un origin válido (quita path/query si vinieran)
    const u = new URL(origin);
    base = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/`;
  } catch {
    return { privacy: [], terms: [], faq: [] };
  }

  /** @type {Record<'privacy'|'terms'|'faq', string[]>} */
  const out = { privacy: [], terms: [], faq: [] };

  /** @type {const} */
  const TYPES = /** @type {const} */ (['privacy', 'terms', 'faq']);

  for (const type of TYPES) {
    const tails = Array.isArray(cfg?.CANDIDATE_TAILS?.[type])
      ? cfg.CANDIDATE_TAILS[type]
      : [];

    // 1) Intento desde el home
    if (homeHtml && tails.length) {
      const hit = findCandidateLink(homeHtml, base, tails, { sameHostOnly });
      if (hit) out[type].push(hit);
    }

    // 2) Fallback: construir URLs directas para cada tail
    for (const t of tails) {
      const abs = safeJoin(base, t);
      if (abs) out[type].push(abs);
    }

    // 3) Normalizar: filtrar inválidas, same-host (si aplica), y de-duplicar
    out[type] = dedupe(out[type].filter((u) => {
      try {
        const uu = new URL(u);
        if (sameHostOnly) {
          const bb = new URL(base);
          if (uu.hostname !== bb.hostname || uu.protocol !== bb.protocol || (bb.port || '') !== (uu.port || '')) {
            return false;
          }
        }
        // Sólo http/https
        return uu.protocol === 'http:' || uu.protocol === 'https:';
      } catch {
        return false;
      }
    }));
  }

  return out;
}

/** Une origin + tail con slash único. */
function safeJoin(base, tail) {
  if (!tail) return null;
  const t = String(tail).replace(/^\/+/, ''); // sin slashes iniciales repetidos
  try {
    return new URL(`/${t}`, base).toString();
  } catch {
    return null;
  }
}

/** De-duplica preservando orden. */
function dedupe(arr) {
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

export default resolveCandidates;