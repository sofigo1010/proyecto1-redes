// chat/src/config/mcp.servers.js
// Declarative registry of MCP stdio servers (multi-MCP ready).
// For now we only register "auditor" (your bevstack mcp-auditor),
// but you can add more blocks later with minimal changes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function siblingAuditorPaths() {
  // this file: chat/src/config → chat/
  const chatDir = path.resolve(__dirname, '..', '..');
  const repoDir = path.resolve(chatDir, '../mcp-auditor'); // sibling repo
  const binJs = path.join(repoDir, 'bin', 'mcp-auditor.js');
  const manifest = path.join(repoDir, 'mcp.manifest.json');
  return { repoDir, binJs, manifest };
}

/**
 * Compute a sensible default command line for the "auditor" server.
 * Priority:
 *  1) env MCP_auditor_CMD (full command line, e.g. "node ../mcp-auditor/bin/mcp-auditor.js")
 *  2) sibling repo: ../mcp-auditor/bin/mcp-auditor.js (run with the current Node)
 *  3) global binary on PATH: "mcp-auditor"
 */
function defaultAuditorCmdLine() {
  const envLine = (process.env.MCP_auditor_CMD || '').trim();
  if (envLine) return envLine;

  const { binJs } = siblingAuditorPaths();
  if (fs.existsSync(binJs)) {
    return `${process.execPath} ${binJs}`;
  }
  return 'mcp-auditor';
}

/**
 * Optional default cwd and env derived from sibling repo if present.
 */
function defaultAuditorCwdAndEnv() {
  const out = { cwd: undefined, env: {} };
  const { repoDir, manifest } = siblingAuditorPaths();

  if (fs.existsSync(repoDir)) {
    out.cwd = repoDir; // run from the auditor repo root by default
  }
  if (!process.env.MCP_auditor_MANIFEST && fs.existsSync(manifest)) {
    out.env.MCP_MANIFEST_PATH = manifest;
  }
  return out;
}

/**
 * Returns a plain config map: serverName -> { cmdLine, cwd?, env? }
 * - cmdLine: full command line string (first token is the executable, rest are args)
 * - cwd: optional working directory (string)
 * - env: optional env object merged on top of process.env for that child
 *
 * Add more servers by adding more keys to this map.
 */
export default function getMcpServersConfig() {
  // Build auditor command line with optional extra args
  const baseCmd = defaultAuditorCmdLine();
  const extraArgs = (process.env.MCP_auditor_ARGS || '').trim();
  const cmdLine = extraArgs ? `${baseCmd} ${extraArgs}` : baseCmd;

  const defaults = defaultAuditorCwdAndEnv();

  return {
    auditor: {
      cmdLine,
      // env overrides precedence: explicit env -> defaults from sibling -> none
      cwd: (process.env.MCP_auditor_CWD || '').trim() || defaults.cwd,
      env: {
        ...(defaults.env || {}),
        ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
        ...(process.env.MCP_auditor_MANIFEST ? { MCP_MANIFEST_PATH: process.env.MCP_auditor_MANIFEST } : {}),
      },
    },

    // Example for a future MCP (copy → edit):
    // search: {
    //   cmdLine: (process.env.MCP_search_CMD || 'node ../mcp-search/bin/server.js').trim(),
    //   cwd: (process.env.MCP_search_CWD || '').trim() || undefined,
    //   env: {
    //     ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
    //     ...(process.env.MCP_search_MANIFEST ? { MCP_MANIFEST_PATH: process.env.MCP_search_MANIFEST } : {}),
    //   },
    // },
  };
}