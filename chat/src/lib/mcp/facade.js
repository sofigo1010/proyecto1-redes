// High-level, multi-MCP facade built on top of the registry.
//
// Se expone una capa simple para que el resto de la app nunca tenga que tratar
// con spawn de procesos ni detalles de JSON-RPC/NDJSON. Esta fachada enruta
// llamadas hacia la “registry” (que gestiona procesos, timeouts y framing),
// y ofrece utilidades con nombres autoexplicativos.
//
// Public API:
//   - ensureReady(serverName?)
//       Verifica que un servidor MCP concreto esté levantado y responda.
//   - listTools(serverName?, { timeoutMs? })
//       Devuelve el catálogo de herramientas expuestas por ese MCP.
//   - callTool(serverName, toolName, args?, { timeoutMs? })
//       Invoca una herramienta con argumentos arbitrarios (objeto o JSON string).
//   - runTool(serverName, toolName, args?, { timeoutMs? })
//       Alias semántico de callTool; se usa desde parseos tipo slash (/mcp).
//   - auditSite(url, { timeoutMs? })
//       Atajo para el servidor “auditor” (Bevstack) y su herramienta audit_site.
//   - withServer(serverName)
//       Crea un “handle” preconfigurado a un MCP (para escalar a múltiples MCP).
//   - closeAll()
//       Cierra y limpia todos los procesos MCP (tests / hot-reload).
//
// Nota: Se comenta en tercera persona, como si el autor explicara el diseño.

import {
  ensureReady as ensureReadyRaw,
  listTools as listToolsRaw,
  callTool as callToolRaw,
  auditSite as auditSiteRaw,
  closeAll as closeAllRaw,
} from './registry.js';

const DEFAULT_SERVER = 'auditor';

/**
 * Verifica que un servidor MCP esté levantado y responda a 'tools/list'.
 * Si el proceso no existe, la registry lo arranca de forma perezosa.
 *
 * @param {string} [serverName='auditor'] - Nombre lógico del MCP.
 * @returns {Promise<boolean>} - Resuelve true si responde correctamente.
 */
export async function ensureReady(serverName = DEFAULT_SERVER) {
  await ensureReadyRaw(serverName);
  return true;
}

/**
 * Lista las herramientas disponibles en un MCP concreto.
 *
 * @param {string} [serverName='auditor'] - Nombre lógico del MCP.
 * @param {{timeoutMs?: number}} [opts]   - Timeout por llamada RPC.
 * @returns {Promise<Array<{name:string, description?:string, input_schema?:any}>>}
 */
export async function listTools(serverName = DEFAULT_SERVER, opts = {}) {
  return listToolsRaw(serverName, opts);
}

/**
 * Llama una herramienta expuesta por un MCP en particular.
 * Acepta args como objeto o como JSON string (se parsea de forma tolerante).
 *
 * @param {string} serverName - Nombre lógico del MCP (p. ej. 'auditor').
 * @param {string} toolName   - Nombre exacto de la herramienta (p. ej. 'audit_site').
 * @param {object|string} [args={}] - Argumentos; objeto plano o JSON string.
 * @param {{timeoutMs?: number}} [opts] - Timeout por llamada RPC.
 * @returns {Promise<any>} - Resultado normalizado de la herramienta.
 */
export async function callTool(serverName, toolName, args = {}, opts = {}) {
  if (!serverName || typeof serverName !== 'string') {
    throw new Error('callTool: "serverName" must be a non-empty string');
  }
  if (!toolName || typeof toolName !== 'string') {
    throw new Error('callTool: "toolName" must be a non-empty string');
  }

  // Se tolera JSON string para facilitar integración con UIs que construyen texto.
  if (args == null) args = {};
  if (typeof args !== 'object') {
    try {
      args = JSON.parse(String(args));
    } catch {
      throw new Error('callTool: "args" must be an object or JSON string');
    }
  }

  return callToolRaw(serverName, toolName, args, opts);
}

/**
 * Alias semántico de callTool; se mantiene separado para legibilidad
 * y flexibilidad futura (p. ej. instrumentación diferencial).
 *
 * @param {string} serverName
 * @param {string} toolName
 * @param {object|string} [args={}]
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<any>}
 */
export async function runTool(serverName, toolName, args = {}, opts = {}) {
  return callTool(serverName, toolName, args, opts);
}

/**
 * Atajo específico para el servidor Bevstack "auditor".
 * Devuelve el reporte de auditoría con el shape esperado por la UI/Claude.
 *
 * @param {string} url - URL http(s) a auditar.
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{ overallPass: boolean, overallScore: number, pages: any[] }>}
 */
export async function auditSite(url, opts = {}) {
  // Alternativa: rutear por runTool(DEFAULT_SERVER, 'audit_site', { url }, opts)
  // Se delega a la envoltura especializada de registry por eficiencia.
  return auditSiteRaw(url, opts);
}

/**
 * Cierra y olvida todos los procesos MCP. Útil en tests y hot-reload.
 */
export function closeAll() {
  return closeAllRaw();
}

/**
 * Devuelve un "handle" preconfigurado para un MCP concreto.
 * Facilita escalar a varios MCPs sin repetir serverName en cada llamada.
 *
 * @example
 *   const search = withServer('search');
 *   await search.ensureReady();
 *   const tools = await search.listTools();
 *   const res   = await search.runTool('web.search', { q: 'hello' });
 *
 * @param {string} serverName
 * @returns {{ ensureReady: () => Promise<boolean>,
 *             listTools: (opts?:{timeoutMs?:number}) => Promise<any[]>,
 *             callTool: (toolName:string, args?:any, opts?:{timeoutMs?:number}) => Promise<any>,
 *             runTool:  (toolName:string, args?:any, opts?:{timeoutMs?:number}) => Promise<any> }}
 */
export function withServer(serverName) {
  if (!serverName || typeof serverName !== 'string') {
    throw new Error('withServer: "serverName" must be a non-empty string');
  }
  return {
    ensureReady: () => ensureReady(serverName),
    listTools:   (opts) => listTools(serverName, opts),
    callTool:    (toolName, args, opts) => callTool(serverName, toolName, args, opts),
    runTool:     (toolName, args, opts) => runTool(serverName, toolName, args, opts),
  };
}

export default {
  ensureReady,
  listTools,
  callTool,
  runTool,
  auditSite,
  withServer,
  closeAll,
};