// Carga y valida el manifest MCP, aplica defaults y sanity checks.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raíz del paquete (dos niveles arriba: src/server -> mcp-auditor)
const PKG_ROOT = path.resolve(__dirname, '../..');

// Defaults razonables si no vienen en el manifest
const DEFAULT_LIMITS = Object.freeze({
  timeout_ms_default: 12_000,
  max_concurrency: 5,
  max_html_size_bytes: 2_000_000,
});

// Esquema mínimo para validar estructura del manifest
const manifestSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    vendor: { type: 'string' },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    limits: {
      type: 'object',
      properties: {
        timeout_ms_default: { type: 'integer', minimum: 1 },
        max_concurrency: { type: 'integer', minimum: 1 },
        max_html_size_bytes: { type: 'integer', minimum: 1 },
      },
      additionalProperties: true,
    },
    env: { type: 'object', additionalProperties: { type: 'string' } },
    tools: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },

          // Aceptar RUTA (string) o esquema inline (object)
          input_schema: { oneOf: [{ type: 'string' }, { type: 'object' }] },
          output_schema: { oneOf: [{ type: 'string' }, { type: 'object' }] },

          input_schema_inline: { type: 'object' },   // compat
          output_schema_inline: { type: 'object' },  // compat

          timeout_ms: { type: 'integer', minimum: 1 },
          optional: { type: 'boolean' },
        },
        required: ['name'],
        additionalProperties: true,
      },
    },
  },
  required: ['name', 'version', 'tools'],
  additionalProperties: true,
};

async function tryRead(p) {
  if (!p) return null;
  try {
    const raw = await fs.readFile(p, 'utf8');
    const json = JSON.parse(raw);
    return { path: p, json };
  } catch {
    return null;
  }
}

/**
 * Carga mcp.manifest.json desde la ubicación adecuada, valida y normaliza.
 * Prioridad:
 *  1) MCP_MANIFEST_PATH (si se define)
 *  2) CWD/mcp.manifest.json
 *  3) PKG_ROOT/mcp.manifest.json (mcp-auditor)
 *  4) PKG_ROOT/../mcp.manifest.json (monorepo padre)
 */
export async function loadManifest(opts = {}) {
  const envPath = process.env.MCP_MANIFEST_PATH
    ? path.resolve(process.env.MCP_MANIFEST_PATH)
    : null;

  const candidates = [
    envPath,                                             // 1) ENV explícito
    path.join(process.cwd(), 'mcp.manifest.json'),       // 2) CWD
    path.join(PKG_ROOT, 'mcp.manifest.json'),            // 3) raíz del paquete
    path.join(PKG_ROOT, '..', 'mcp.manifest.json'),      // 4) raíz del monorepo
  ].filter(Boolean);

  let found = null;
  for (const c of candidates) {
    const hit = await tryRead(c);
    if (hit) { found = hit; break; }
  }

  if (!found) {
    const list = candidates.map(c => `- ${c}`).join('\n');
    throw new Error(`Manifest not found. Checked:\n${list}`);
  }

  let manifest = found.json;

  // Defaults
  manifest.transport ||= 'stdio';
  manifest.limits = { ...DEFAULT_LIMITS, ...(manifest.limits || {}) };

  // Validación base
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(manifestSchema);
  const ok = validate(manifest);
  if (!ok) {
    const err = new Error('Invalid manifest structure');
    err.data = { errors: validate.errors || [] };
    throw err;
  }

  // Sanity checks de tools
  const seen = new Set();
  for (const tool of manifest.tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name in manifest: ${tool.name}`);
    }
    seen.add(tool.name);

    // Normaliza: si no hay input_schema declarada, poner objeto vacío
    if (!tool.input_schema && !tool.input_schema_inline) {
      tool.input_schema_inline = { type: 'object', additionalProperties: false };
    }
  }

  return Object.freeze(manifest);
}

export default loadManifest;