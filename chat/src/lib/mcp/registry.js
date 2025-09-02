// chat/src/lib/mcp/registry.js
// Multi-MCP process registry: spawns one stdio JSON-RPC client per server name.
// - Reads server definitions from src/config/mcp.servers.js
// - Speaks NDJSON (JSON-RPC 2.0) over STDIN/STDOUT
// - Per-request timeouts, idle TTL auto-shutdown
// - Public API (exported at bottom):
//     ensureReady(serverName?)
//     listTools(serverName?, { timeoutMs? })
//     callTool(serverName, toolName, args, { timeoutMs? })
//     auditSite(url, { timeoutMs? })  // convenience for server "auditor"

import { spawn as nodeSpawn } from 'node:child_process';
import * as path from 'node:path';
import getMcpServersConfig from '../../config/mcp.servers.js';

const DEFAULT_SERVER = 'auditor';

const LOG = (lvl, ...args) => {
  const want = (process.env.MCP_LOG_LEVEL || 'info').toLowerCase();
  const order = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
  if ((order[lvl] ?? 2) <= (order[want] ?? 2)) {
    // eslint-disable-next-line no-console
    console[lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'log']('[mcp-registry]', ...args);
  }
};

function toNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseCmdLine(cmdLine) {
  // Simple split by whitespace (works for typical cases like "node ../mcp-x/bin/server.js")
  // If you need advanced quoting with spaces in paths, upgrade to a shell-words parser.
  const parts = String(cmdLine || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error('Empty MCP cmdLine');
  return { command: parts[0], args: parts.slice(1) };
}

class ServerProcess {
  constructor(name, { cmdLine, cwd, env }) {
    this.name = name;
    this.cmdLine = cmdLine;
    this.cwd = cwd || process.cwd();
    this.env = { ...process.env, ...(env || {}) };

    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.idleTimer = null;
    this.lastUsedAt = 0;

    this.reqTimeoutMs = toNum(process.env.MCP_REQUEST_TIMEOUT_MS, 30_000);
    this.idleTtlMs = toNum(process.env.MCP_IDLE_TTL_MS, 120_000);
  }

  start() {
    if (this.child) return;

    const { command, args } = parseCmdLine(this.cmdLine);
    LOG('info', `Starting MCP "${this.name}":`, command, args.join(' '), 'cwd=', this.cwd);

    this.child = nodeSpawn(command, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'inherit'], // inherit stderr to see server logs
    });

    this.child.on('exit', (code, signal) => {
      LOG('warn', `MCP "${this.name}" exited code=${code} signal=${signal}`);
      // Reject all pending requests
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`MCP "${this.name}" process exited`));
      }
      this.pending.clear();
      this.child = null;
      this.buffer = '';
      this._clearIdle();
    });

    // Always use classic Node streams (no .getReader in Node)
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this._onStdout(chunk));

    this._touch();
    this._armIdle();
  }

  stop() {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {}
    this.child = null;
    this._clearIdle();
  }

  _onStdout(chunk) {
    this.buffer += chunk;

    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trimEnd();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        LOG('warn', `Ignoring non-JSON line from "${this.name}":`, line.slice(0, 200));
        continue;
      }
      this._handleRpcMessage(msg);
    }
  }

  _handleRpcMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        const err = new Error(msg.error?.message || 'MCP error');
        err.code = msg.error?.code;
        err.data = msg.error?.data;
        p.reject(err);
        return;
      }
      p.resolve(msg.result);
      return;
    }

    // Notifications (no id) — ignore
  }

  async rpc(method, params, { timeoutMs } = {}) {
    this.start();
    this._touch();

    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method };
    if (params != null) payload.params = params;

    const line = JSON.stringify(payload) + '\n';
    const toMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.reqTimeoutMs;

    const prom = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP "${this.name}" request timeout (${toMs}ms): ${method}`));
      }, toMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    try {
      this.child.stdin.write(line, 'utf8');
    } catch (e) {
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
      }
      throw e;
    }

    return prom;
  }

  async ensureReady() {
    // Lightweight ping by listing tools; some servers use this to settle framing.
    try {
      await this.rpc('tools/list', undefined, { timeoutMs: 10_000 });
    } catch {
      // Retry once in case of early framing noise
      await this.rpc('tools/list', undefined, { timeoutMs: 10_000 });
    }
    return true;
  }

  _touch() {
    this.lastUsedAt = Date.now();
  }

  _armIdle() {
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs <= 0) return;
    this._clearIdle();
    this.idleTimer = setInterval(() => {
      if (!this.child) return this._clearIdle();
      const now = Date.now();
      if (now - this.lastUsedAt > this.idleTtlMs) {
        LOG('info', `MCP "${this.name}" idle > ${this.idleTtlMs}ms, terminating…`);
        this.stop();
      }
    }, Math.min(30_000, this.idleTtlMs));
  }

  _clearIdle() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ---------------- Registry (one ServerProcess per server name) ----------------

const servers = new Map(); // name -> ServerProcess

function getOrCreateServer(name = DEFAULT_SERVER) {
  const cfgMap = getMcpServersConfig();
  const cfg = cfgMap[name];
  if (!cfg) {
    const known = Object.keys(cfgMap).join(', ') || '(none)';
    throw new Error(`Unknown MCP server "${name}". Known: ${known}`);
  }

  let inst = servers.get(name);
  if (inst) return inst;

  const { cmdLine, cwd, env } = cfg;

  // Resolve cwd if it contains relative parts
  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();

  inst = new ServerProcess(name, { cmdLine, cwd: resolvedCwd, env });
  servers.set(name, inst);
  return inst;
}

// ---------------- Public API ----------------

export async function ensureReady(serverName = DEFAULT_SERVER) {
  const s = getOrCreateServer(serverName);
  await s.ensureReady();
  return true;
}

export async function listTools(serverName = DEFAULT_SERVER, { timeoutMs } = {}) {
  const s = getOrCreateServer(serverName);
  const res = await s.rpc('tools/list', undefined, { timeoutMs });
  if (res && Array.isArray(res.tools)) return res.tools;
  if (Array.isArray(res)) return res;
  return [];
}

export async function callTool(serverName, toolName, args = {}, { timeoutMs } = {}) {
  if (!serverName) throw new Error('callTool: serverName is required');
  if (!toolName) throw new Error('callTool: toolName is required');

  const s = getOrCreateServer(serverName);
  const result = await s.rpc(
    'tools/call',
    { name: toolName, arguments: args },
    { timeoutMs }
  );
  // Some servers return { name, result }, others just { result } or plain output
  return result?.result ?? result;
}

// Convenience for bevstack "auditor" server
export async function auditSite(url, { timeoutMs } = {}) {
  if (!validHttpUrl(url)) {
    throw new Error(`Invalid URL for audit: "${url}"`);
  }
  const out = await callTool('auditor', 'audit_site', { url }, { timeoutMs });
  if (!out || typeof out !== 'object') {
    throw new Error('Invalid audit response from MCP');
  }
  return out; // expected shape: { overallPass, overallScore, pages: [...] }
}

export function closeAll() {
  for (const s of servers.values()) {
    s.stop();
  }
  servers.clear();
}

// ---------------- utils ----------------

function validHttpUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}