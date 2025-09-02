// src/tools/get_templates_info.js
// Tool MCP: get_templates_info
// Devuelve { templates: [{ name, path, size }] }

import { getTemplatesInfo } from '../lib/match/templateMatcher.js';

export default async function getTemplatesInfoTool(_args, { log }) {
  try {
    const templates = await getTemplatesInfo(['PP.pdf', 'TOS.pdf', 'CS.pdf']);
    return { templates };
  } catch (err) {
    log?.('error', 'get_templates_info failed:', err?.stack || err);
    // Responder con shape válido pero vacío ante error
    return { templates: [] };
  }
}