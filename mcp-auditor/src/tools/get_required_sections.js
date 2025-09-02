// src/tools/get_required_sections.js
// Tool MCP: get_required_sections
// Input:  { type: "privacy"|"terms"|"faq" }
// Output: { sections: string[] }

import { getRequiredSections } from '../lib/audit/requiredSections.js';
import { loadEnvConfig } from '../config/env.js';

/**
 * @param {{ type:'privacy'|'terms'|'faq' }} args
 * @param {{ log?:(level:string,...args:any[])=>void }} ctx
 */
export default async function getRequiredSectionsTool(args, { log }) {
  try {
    const env = loadEnvConfig();
    const type = args?.type;
    // Validación mínima por si el host no valida schemas
    if (!type || !['privacy', 'terms', 'faq'].includes(type)) {
      return { sections: [] };
    }
    const sections = getRequiredSections(type, env);
    return { sections };
  } catch (err) {
    log?.('error', 'get_required_sections failed:', err?.stack || err);
    return { sections: [] };
  }
}