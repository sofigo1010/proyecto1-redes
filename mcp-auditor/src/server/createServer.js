// Carga el manifest, registra tools y maneja JSON-RPC para MCP.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import addFormats from 'ajv-formats';
import Ajv from 'ajv';
import { loadManifest } from './manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..'); 

function resolveFromRoot(p) {
  if (!p) return null;
  if (p.startsWith('file://')) return fileURLToPath(p);
  if (path.isAbsolute(p)) return p;
  return path.join(projectRoot, p);
}

function toJsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toJsonRpcError(id, code, message, data) {
  const err = { jsonrpc: '2.0', id, error: { code, message } };
  if (data !== undefined) err.error.data = data;
  return err;
}

export async function createServer({ log = () => {} } = {}) {
  // 1) Manifest
  const manifest = await loadManifest({ root: projectRoot });
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv); // <- esto elimina el warning y valida "format": "uri"

  // 2) Cargar schemas (inline o por archivo)
    async function loadSchemaMaybe(primary, secondary) {
    // helper: convierte valor (obj o path) a objeto esquema
    const toSchema = async (val) => {
        if (!val) return null;
        if (typeof val === 'object') return val; // inline
        if (typeof val === 'string') {
        const abs = resolveFromRoot(val);
        const raw = await fs.readFile(abs, 'utf8');
        return JSON.parse(raw);
        }
        return null;
    };
    // intenta primero el primario; si no, el secundario
    return (await toSchema(primary)) ?? (await toSchema(secondary));
    }

  // 3) Construir registro de tools
  const tools = {};
  for (const t of manifest.tools || []) {
    const inputSchema = await loadSchemaMaybe(t.input_schema_inline, t.input_schema);
    const outputSchema = await loadSchemaMaybe(t.output_schema_inline, t.output_schema);

    let validateInput = null;
    let validateOutput = null;
    if (inputSchema) validateInput = ajv.compile(inputSchema);
    if (outputSchema) validateOutput = ajv.compile(outputSchema);

    tools[t.name] = {
      name: t.name,
      description: t.description || '',
      inputSchema,
      outputSchema,
      validateInput,
      validateOutput,
      timeoutMs: t.timeout_ms || manifest.limits?.timeout_ms_default || 12000,
      optional: !!t.optional,
      // Carga perezosa de implementación real
      async exec(args) {
        switch (t.name) {
          case 'audit_site': {
            const mod = await import(pathToFileURL(resolveFromRoot('src/tools/audit_site.js')).href);
            if (typeof mod.default !== 'function') {
              throw new Error('Tool audit_site not implemented yet');
            }
            return await mod.default(args, { log, manifest, projectRoot });
          }
          case 'get_required_sections': {
            const mod = await import(pathToFileURL(resolveFromRoot('src/tools/get_required_sections.js')).href);
            if (typeof mod.default !== 'function') {
              throw new Error('Tool get_required_sections not implemented yet');
            }
            return await mod.default(args, { log, manifest, projectRoot });
          }
          case 'get_templates_info': {
            const mod = await import(pathToFileURL(resolveFromRoot('src/tools/get_templates_info.js')).href);
            if (typeof mod.default !== 'function') {
              throw new Error('Tool get_templates_info not implemented yet');
            }
            return await mod.default(args, { log, manifest, projectRoot });
          }
          case 'dry_run': {
            const mod = await import(pathToFileURL(resolveFromRoot('src/tools/dry_run.js')).href);
            if (typeof mod.default !== 'function') {
              throw new Error('Tool dry_run not implemented yet');
            }
            return await mod.default(args, { log, manifest, projectRoot });
          }
          default:
            throw new Error(`Unknown tool: ${t.name}`);
        }
      },
    };
  }

  // 4) API de servidor consumida por stdioTransport
  async function listTools() {
    return Object.values(tools).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema || null,
    }));
  }

  // Validación + ejecución con timeouts
  async function callTool(name, args) {
    const t = tools[name];
    if (!t) throw new Error(`Tool not found: ${name}`);

    if (t.validateInput) {
      const ok = t.validateInput(args || {});
      if (!ok) {
        const errors = t.validateInput.errors || [];
        const msg = `Invalid input for ${name}`;
        const data = { errors };
        const e = new Error(msg);
        e.data = data;
        e.code = -32602; // Invalid params
        throw e;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t.timeoutMs);

    try {
      const res = await t.exec(args || {}, { signal: controller.signal });
      if (t.validateOutput) {
        const ok = t.validateOutput(res);
        if (!ok) {
          const errors = t.validateOutput.errors || [];
          const e = new Error(`Tool ${name} produced invalid output`);
          e.data = { errors };
          e.code = -32001;
          throw e;
        }
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // 5) Manejador JSON-RPC básico
  async function handleRequest(payload) {
    const { id = null, method, params } = payload || {};
    try {
      switch (method) {
        case 'ping':
          return toJsonRpcResult(id, { ok: true, ts: Date.now() });

        case 'manifest/get':
          return toJsonRpcResult(id, {
            name: manifest.name,
            version: manifest.version,
            vendor: manifest.vendor || null,
            transport: manifest.transport || 'stdio',
            limits: manifest.limits || {},
          });

        case 'tools/list': {
          const result = await listTools();
          return toJsonRpcResult(id, { tools: result });
        }

        case 'tools/call': {
            const callParams = params || {};
            const name = callParams.name;
            const args = callParams.arguments || {};

            if (!name) {
                return toJsonRpcError(id, -32602, 'Missing tool name');
            }

            try {
                // Usa el registro y la función de orquestación con validación + timeout
                const result = await callTool(name, args);
                return toJsonRpcResult(id, { name, result });
            } catch (err) {
                console.error('[error] tools/call failed:', name, err?.stack || err);
                const code = Number.isInteger(err?.code) ? err.code : -32000;
                return toJsonRpcError(id, code, String(err?.message || err), err?.data);
            }
        }

        default:
          return toJsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      log('error', 'handleRequest error:', err?.stack || err);
      const code = err?.code ?? -32000;
      const message = err?.message ?? 'Internal error';
      return toJsonRpcError(id, code, message, err?.data);
    }
  }

  async function shutdown() {
    // Hook para liberar recursos si hiciera falta
    log('info', 'Server shutdown');
  }

  return {
    handleRequest,
    shutdown,
    listTools,
    callTool,
    manifest,
  };
}

export default createServer;