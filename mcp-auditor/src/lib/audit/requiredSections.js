// src/lib/audit/requiredSections.js
// Gestión de "secciones requeridas" por tipo de página y ayuda para validarlas.
//
// Exporta:
//  - getRequiredSections(type, cfg): string[]
//  - normalizeSectionName(s): string
//  - normalizeTextForMatch(s): string
//  - findSectionsInText(plainText, sections): { found:string[], missing:string[] }
//
// La detección es simple y robusta a mayúsculas/espacios. Si quieres reglas
// más estrictas (p. ej., regex con límites de palabra), puedes afinarlas aquí.

import { loadEnvConfig } from '../../config/env.js';

/** Normaliza el nombre de la sección (para comparar). */
export function normalizeSectionName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')   // NBSP -> espacio
    .replace(/\s+/g, ' ')      // colapsar espacios
    .trim();
}

/** Normaliza el texto plano antes de buscar secciones. */
export function normalizeTextForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Devuelve la lista de secciones requeridas por tipo.
 * @param {'privacy'|'terms'|'faq'} type
 * @param {{ REQUIRED_SECTIONS?: Record<string, string[]> }} [cfg]
 */
export function getRequiredSections(type, cfg) {
  const env = cfg || loadEnvConfig();
  const map = env.REQUIRED_SECTIONS || {};
  const raw = Array.isArray(map[type]) ? map[type] : [];
  // Normalizamos para garantizar comparaciones coherentes
  return raw.map(normalizeSectionName).filter(Boolean);
}

/**
 * Detecta qué secciones están presentes en el texto.
 * Coincidencia simple por substring (normalizado).
 * @param {string} plainText  Texto ya convertido a plano (HTML->texto)
 * @param {string[]} sections Lista de nombres de sección (ya normalizados, opcional)
 * @returns {{ found:string[], missing:string[] }}
 */
export function findSectionsInText(plainText, sections) {
  const text = normalizeTextForMatch(plainText);
  const list = (sections || []).map(normalizeSectionName).filter(Boolean);

  const found = [];
  const missing = [];

  for (const q of list) {
    if (!q) continue;
    // Búsqueda directa; si quieres bordes de palabra, reemplaza por regex:
    // const re = new RegExp(`\\b${escapeRegex(q)}\\b`, 'i');
    // const hit = re.test(text);
    const hit = text.includes(q);
    if (hit) found.push(q);
    else missing.push(q);
  }

  return { found, missing };
}

// Utilidad por si más adelante cambiamos a regex con \b
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  getRequiredSections,
  normalizeSectionName,
  normalizeTextForMatch,
  findSectionsInText,
};