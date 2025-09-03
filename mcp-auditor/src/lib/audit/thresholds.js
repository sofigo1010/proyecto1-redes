// Reglas de umbrales y pase por tipo (privacy, terms, faq).
// Lee defaults/overrides desde env.js y ofrece helpers puros.
//
// Exporta:
//  - getSimilarityThreshold(type, cfg)
//  - evaluatePagePass(type, metrics, cfg) -> { pass:boolean, notes:string[] }
//
// Donde metrics puede incluir:
//  - similarity: number (0–100)           [requerido]
//  - sectionsMissingCount?: number        [opcional, default 0]
//  - typoRate?: number (0–1)              [opcional, default 0]
//  - minSimilarity?: number               [opcional: override puntual]

import { loadEnvConfig } from '../../config/env.js';

/** Umbral de similitud por tipo, con overrides por ENV. */
export function getSimilarityThreshold(type, cfg) {
  const env = cfg || loadEnvConfig();
  const hard = clampPct(env.PASS_THRESHOLD ?? 80);
  const soft = clampPct(env.FAQ_SOFT_PASS ?? 60);

  switch (type) {
    case 'privacy':
    case 'terms':
      return hard;
    case 'faq':
      return soft;
    default:
      return hard;
  }
}

/**
 * Evalúa si una página pasa, combinando similitud + señales opcionales.
 * Reglas:
 *  - Similitud >= umbral del tipo (hard para PP/TOS, soft para FAQ).
 *  - Si sectionsMissingCount > 0, se permite como máximo 1 sección faltante
 *    cuando la similitud supera el umbral por ≥10 pts; si no, falla suave.
 *  - Si typoRate > 0.08 (8%), se marca como nota; si > 0.15, puede reprobar
 *    salvo que la similitud supere el umbral en ≥15 pts (tolerancia).
 *
 * @param {'privacy'|'terms'|'faq'} type
 * @param {{ similarity:number, sectionsMissingCount?:number, typoRate?:number, minSimilarity?:number }} metrics
 * @param {*} [cfg]
 * @returns {{ pass:boolean, notes:string[] }}
 */
export function evaluatePagePass(type, metrics, cfg) {
  const env = cfg || loadEnvConfig();
  const notes = [];

  const baseThr = getSimilarityThreshold(type, env);
  const sim = clampPct(metrics?.similarity ?? 0);
  const thr = clampPct(metrics?.minSimilarity ?? baseThr);

  const missing = Math.max(0, Math.trunc(metrics?.sectionsMissingCount ?? 0));
  const typoRate = clamp01(metrics?.typoRate ?? 0);

  // Regla principal: similitud vs umbral por tipo
  let pass = sim >= thr;

  // Ajustes por secciones faltantes
  if (missing > 0) {
    if (sim >= thr + 10 && missing <= 1) {
      notes.push(`Se permite 1 sección faltante por similitud alta (${sim} ≥ ${thr + 10}).`);
      // mantiene pass
    } else {
      notes.push(`Faltan ${missing} sección(es) requerida(s).`);
      pass = false;
    }
  }

  // Ajustes por errores ortográficos
  if (typoRate > 0.15) {
    if (sim >= thr + 15) {
      notes.push(`Alto typoRate (${(typoRate * 100).toFixed(1)}%), pero similitud muy alta (${sim}).`);
    } else {
      notes.push(`Alto typoRate (${(typoRate * 100).toFixed(1)}%).`);
      pass = false;
    }
  } else if (typoRate > 0.08) {
    notes.push(`typoRate moderado (${(typoRate * 100).toFixed(1)}%).`);
    // No cambia pass
  }

  // Nota informativa de similitud
  if (!pass && sim < thr) {
    notes.push(`Similitud ${sim} < umbral ${thr} para ${type}.`);
  }

  return { pass, notes };
}

function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export default {
  getSimilarityThreshold,
  evaluatePagePass,
};