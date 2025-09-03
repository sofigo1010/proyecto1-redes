// Multi-MCP process registry (stdio JSON-RPC + NDJSON).
// Handshake robusto:
//  - Envia 'initialize' y luego notificación 'initialized'.
//  - Espera a que el server quede listo con un sondeo a 'tools/list' y backoff.
// API: ensureReady, listTools, callTool, auditSite, closeAll.

import { spawn as nodeSpawn } from 'node:child_process';
import * as path from 'node:path';
import getMcpServersConfig from '../../config/mcp.servers.js';

const DEFAULT_SERVER = 'auditor';
const LOG = (lvl, ...args) => {
  const want = (process.env.MCP_LOG_LEVEL || 'info').toLowerCase();
  const order = { error:0, warn:1, info:2, debug:3, trace:4 };
  if ((order[lvl] ?? 2) <= (order[want] ?? 2)) {
    // eslint-disable-next-line no-console
    console[lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'log']('[mcp-registry]', ...args);
  }
};
const toNum = (v,d) => Number.isFinite(Number(v)) ? Number(v) : d;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCmdLine(cmdLine) {
  const parts = String(cmdLine || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error('Empty MCP cmdLine');
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
    this.pending = new Map();
    this.idleTimer = null;
    this.lastUsedAt = 0;

    this.initialized = false;
    this.initPromise = null;

    this.reqTimeoutMs = toNum(process.env.MCP_REQUEST_TIMEOUT_MS, 30_000);
    this.idleTtlMs    = toNum(process.env.MCP_IDLE_TTL_MS,       120_000);
  }

  start() {
    if (this.child) return;
    const { command, args } = parseCmdLine(this.cmdLine);
    LOG('info', `Starting MCP "${this.name}":`, command, args.join(' '), 'cwd=', this.cwd);
    this.child = nodeSpawn(command, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.child.on('exit', (code, signal) => {
      LOG('warn', `MCP "${this.name}" exited code=${code} signal=${signal}`);
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(`MCP "${this.name}" process exited`)); }
      this.pending.clear();
      this.child = null;
      this.buffer = '';
      this._clearIdle();
      this.initialized = false;
      this.initPromise = null;
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this._onStdout(chunk));
    this._touch();
    this._armIdle();
  }

  stop() {
    if (!this.child) return;
    try { this.child.kill(); } catch {}
    this.child = null;
    this._clearIdle();
    this.initialized = false;
    this.initPromise = null;
  }

  _onStdout(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trimEnd();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;

      let msg;
      try { msg = JSON.parse(line); } catch { LOG('warn', `Ignoring non-JSON line from "${this.name}":`, line.slice(0,200)); continue; }
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
        // @ts-ignore
        err.code = msg.error?.code;
        // @ts-ignore
        err.data = msg.error?.data;
        p.reject(err);
        return;
      }
      p.resolve(msg.result);
    }
    // Notificaciones del server (sin id) se ignoran por ahora.
  }

  _send(payload) {
    try { this.child.stdin.write(JSON.stringify(payload) + '\n', 'utf8'); }
    catch (e) { throw e; }
  }

  /** Notificación (sin id). */
  notify(method, params) {
    this.start();
    const p = { jsonrpc: '2.0', method };
    if (params !== undefined) p.params = params;
    try { this._send(p); } catch (e) {
      LOG('warn', `notify "${this.name}" ${method} failed:`, e?.message || e);
    }
  }

  async _rpc(method, params, { timeoutMs } = {}) {
    this.start();
    this._touch();

    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method };
    if (params != null) payload.params = params;

    const toMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.reqTimeoutMs;

    const prom = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP "${this.name}" request timeout (${toMs}ms): ${method}`));
      }, toMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    this._send(payload);
    return prom;
  }

  async rpc(method, params, { timeoutMs } = {}) {
    if (method !== 'initialize') await this._ensureReadyBarrier();
    return this._rpc(method, params, { timeoutMs });
  }

  /** Envía initialize → initialized y espera a que el server acepte ya 'tools/list'. */
  async _ensureReadyBarrier() {
    if (this.initialized) return true;
    if (this.initPromise) return this.initPromise;

    this.start();
    const params = {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'sofig-chat', version: '0.1.0' },
    };

    this.initPromise = (async () => {
      LOG('debug', `Initializing MCP "${this.name}"…`);
      try {
        await this._rpc('initialize', params, { timeoutMs: 10_000 });
      } catch (e) {
        const msg = String(e?.message || '');
        const code = e?.code;
        if (code === -32601 || /method\s+not\s+found/i.test(msg)) {
          LOG('info', `MCP "${this.name}" does not implement 'initialize' → tolerated`);
        } else {
          throw e;
        }
      }

      // Completa handshake (muchos servers esperan esta notificación)
      this.notify('notifications/initialized', {});

      // Pequeña gracia + sondeo con backoff hasta que deje de rechazar por init incompleto
      let delay = 120;
      for (let i = 0; i < 5; i++) {
        try {
          await sleep(delay);
          await this._rpc('tools/list', undefined, { timeoutMs: 5_000 });
          this.initialized = true;
          return true;
        } catch (e) {
          const msg = String(e?.message || '');
          if (/before initialization was complete/i.test(msg) || /initializ/i.test(msg)) {
            delay = Math.min(1000, Math.round(delay * 1.6));
            continue;
          }
          // Si falla por otro motivo, no bloqueamos el ready (puede no implementar tools/list)
          this.initialized = true;
          return true;
        }
      }
      this.initialized = true;
      return true;
    })().finally(() => {
      // limpiar promesa para futuros callers
      setTimeout(() => { this.initPromise = null; }, 0);
    });

    return this.initPromise;
  }

  async ensureReady() {
    await this._ensureReadyBarrier();
    // Segundo sondeo “suave” por si el server aún está terminando cosas
    try { await this._rpc('tools/list', undefined, { timeoutMs: 8_000 }); } catch {}
    return true;
  }

  _touch() { this.lastUsedAt = Date.now(); }
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
  _clearIdle() { if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; } }
}

// ---------------- Registry ----------------
const servers = new Map();
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
  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();
  inst = new ServerProcess(name, { cmdLine, cwd: resolvedCwd, env });
  servers.set(name, inst);
  return inst;
}

// --------------- API pública ---------------
export async function ensureReady(serverName = DEFAULT_SERVER) {
  const s = getOrCreateServer(serverName);
  await s.ensureReady();
  return true;
}

export async function listTools(serverName = DEFAULT_SERVER, { timeoutMs } = {}) {
  const s = getOrCreateServer(serverName);
  await s.ensureReady();
  const res = await s._rpc('tools/list', undefined, { timeoutMs });
  if (res && Array.isArray(res.tools)) return res.tools;
  if (Array.isArray(res)) return res;
  return [];
}

export async function callTool(serverName, toolName, args = {}, { timeoutMs } = {}) {
  if (!serverName) throw new Error('callTool: serverName is required');
  if (!toolName) throw new Error('callTool: toolName is required');
  const s = getOrCreateServer(serverName);
  await s.ensureReady();
  const result = await s._rpc('tools/call', { name: toolName, arguments: args ?? {} }, { timeoutMs });
  return result?.result ?? result;
}

// Atajo específico Bevstack
export async function auditSite(url, { timeoutMs } = {}) {
  if (!validHttpUrl(url)) throw new Error(`Invalid URL for audit: "${url}"`);
  const out = await callTool('auditor', 'audit_site', { url }, { timeoutMs });
  if (!out || typeof out !== 'object') throw new Error('Invalid audit response from MCP');
  return out;
}

export function closeAll() {
  for (const s of servers.values()) s.stop();
  servers.clear();
}

function validHttpUrl(u) {
  try { const url = new URL(String(u)); return url.protocol === 'http:' || url.protocol === 'https:'; }
  catch { return false; }
}