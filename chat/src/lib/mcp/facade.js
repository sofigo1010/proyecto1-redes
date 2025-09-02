// chat/src/lib/mcp/facade.js
// High-level, multi-MCP facade built on top of the registry.
// Exposes simple helpers so the rest of your app never needs to touch
// process spawning or JSON-RPC details.
//
// Public API:
//   - ensureReady(serverName?)
//   - listTools(serverName?, { timeoutMs? })
//   - callTool(serverName, toolName, args?, { timeoutMs? })
//   - auditSite(url, { timeoutMs? })  // convenience for 'auditor' server
//   - closeAll()

import {
  ensureReady as ensureReadyRaw,
  listTools as listToolsRaw,
  callTool as callToolRaw,
  auditSite as auditSiteRaw,
  closeAll as closeAllRaw,
} from './registry.js';

const DEFAULT_SERVER = 'auditor';

/**
 * Ensure a given MCP server is spawned and responsive.
 * @param {string} [serverName='auditor']
 */
export async function ensureReady(serverName = DEFAULT_SERVER) {
  return ensureReadyRaw(serverName);
}

/**
 * List available tools for a given MCP server.
 * @param {string} [serverName='auditor']
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<Array<{name:string, description?:string, input_schema?:any}>>>}
 */
export async function listTools(serverName = DEFAULT_SERVER, opts = {}) {
  return listToolsRaw(serverName, opts);
}

/**
 * Generic tool caller for any MCP server.
 * @param {string} serverName
 * @param {string} toolName
 * @param {object} [args={}]
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<any>} tool result (server-normalized)
 */
export async function callTool(serverName, toolName, args = {}, opts = {}) {
  if (!serverName || typeof serverName !== 'string') {
    throw new Error('callTool: "serverName" must be a non-empty string');
  }
  if (!toolName || typeof toolName !== 'string') {
    throw new Error('callTool: "toolName" must be a non-empty string');
  }
  return callToolRaw(serverName, toolName, args, opts);
}

/**
 * Convenience wrapper for the Bevstack auditor (server "auditor").
 * @param {string} url - http(s) URL to audit
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{ overallPass: boolean, overallScore: number, pages: any[] }>}
 */
export async function auditSite(url, opts = {}) {
  return auditSiteRaw(url, opts);
}

/**
 * Close and forget all MCP child processes (useful in tests or dev hot-reload).
 */
export function closeAll() {
  return closeAllRaw();
}

export default {
  ensureReady,
  listTools,
  callTool,
  auditSite,
  closeAll,
};