// Multi-MCP process registry: mantiene un proceso hijo por servidor MCP y
// habla JSON-RPC 2.0 por STDIN/STDOUT con framing NDJSON.
//
// Se apoya en `src/config/mcp.servers.js` para conocer cómo arrancar cada
// servidor (comando, cwd, env). Proporciona timeouts por petición, apagado
// automático por inactividad y una API de alto nivel para invocar herramientas.
//
// API pública (exportada al final):
//   - ensureReady(serverName?)             → Arranca y comprueba que responde.
//   - listTools(serverName?, {timeoutMs?}) → Devuelve herramientas disponibles.
//   - callTool(serverName, tool, args, {timeoutMs?})
//   - auditSite(url, {timeoutMs?})         → Atajo para el servidor "auditor".
//   - closeAll()                           → Cierra y limpia todos los procesos.

import { spawn as nodeSpawn } from 'node:child_process';
import * as path from 'node:path';
import getMcpServersConfig from '../../config/mcp.servers.js';

// Nombre por defecto del servidor cuando no se especifica.
const DEFAULT_SERVER = 'auditor';

// Pequeño logger con control por nivel vía MCP_LOG_LEVEL (error|warn|info|debug|trace).
// Se usa para depurar sin inundar la consola en producción.
const LOG = (lvl, ...args) => {
  const want = (process.env.MCP_LOG_LEVEL || 'info').toLowerCase();
  const order = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
  if ((order[lvl] ?? 2) <= (order[want] ?? 2)) {
    // eslint-disable-next-line no-console
    console[lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'log']('[mcp-registry]', ...args);
  }
};

// Convierte un valor a número con fallback `d` cuando no es finito.
// Se usa para leer timeouts de env de forma tolerante.
function toNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Parsea una línea de comando "simple" en {command, args}.
// Se usa con comandos tipo "node ../mcp-x/bin/server.js".
// Nota: si se requieren rutas con espacios y comillas complejas, convendría
// introducir un parser de shell más completo.
function parseCmdLine(cmdLine) {
  const parts = String(cmdLine || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error('Empty MCP cmdLine');
  return { command: parts[0], args: parts.slice(1) };
}

// ------------------------------ Proceso MCP ------------------------------
//
// ServerProcess encapsula el ciclo de vida del proceso hijo (un servidor MCP).
// - Se encarga de arrancarlo (start), cortarlo por inactividad (idle TTL),
//   leer y ensamblar líneas NDJSON desde stdout, y resolver/rehusar promesas
//   de peticiones JSON-RPC.
// - Cada instancia mantiene un mapa de peticiones pendientes (id → {resolve, reject, timer}).

class ServerProcess {
  /**
   * @param {string} name  Nombre lógico del servidor (p.ej. "auditor").
   * @param {{cmdLine:string, cwd?:string, env?:Record<string,string>}} cfg
   */
  constructor(name, { cmdLine, cwd, env }) {
    this.name = name;
    this.cmdLine = cmdLine;
    this.cwd = cwd || process.cwd();
    this.env = { ...process.env, ...(env || {}) };

    this.child = null;       // Proceso hijo (spawn)
    this.buffer = '';        // Buffer para ensamblar líneas NDJSON
    this.nextId = 1;         // Contador incremental de ids JSON-RPC
    this.pending = new Map();// id → { resolve, reject, timer }
    this.idleTimer = null;   // Intervalo para vigilar inactividad
    this.lastUsedAt = 0;     // Marca de último uso (ms epoch)

    // Timeouts leídos de env con fallback.
    this.reqTimeoutMs = toNum(process.env.MCP_REQUEST_TIMEOUT_MS, 30_000);
    this.idleTtlMs    = toNum(process.env.MCP_IDLE_TTL_MS,       120_000);
  }

  // Arranca el proceso MCP si no está activo y fija manejadores de salida y stdout.
  start() {
    if (this.child) return;

    const { command, args } = parseCmdLine(this.cmdLine);
    LOG('info', `Starting MCP "${this.name}":`, command, args.join(' '), 'cwd=', this.cwd);

    this.child = nodeSpawn(command, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'inherit'], // Se hereda stderr para ver logs del servidor.
    });

    // Ante salida del proceso, se rechazan todas las peticiones pendientes y se limpia estado.
    this.child.on('exit', (code, signal) => {
      LOG('warn', `MCP "${this.name}" exited code=${code} signal=${signal}`);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`MCP "${this.name}" process exited`));
      }
      this.pending.clear();
      this.child = null;
      this.buffer = '';
      this._clearIdle();
    });

    // Lectura por líneas de stdout (NDJSON). No se usa .getReader; se delega a streams de Node.
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this._onStdout(chunk));

    this._touch();
    this._armIdle();
  }

  // Detiene el proceso MCP si está activo y limpia el temporizador de idle.
  stop() {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {}
    this.child = null;
    this._clearIdle();
  }

  // Acumula salida en buffer y despacha líneas completas a _handleRpcMessage().
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

  // Resuelve/rechaza promesas pendientes si llega una respuesta con "id".
  // Respuestas sin "id" (notificaciones) se ignoran por ahora.
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

    // Si el servidor emite notificaciones (sin id), por ahora no se manejan.
  }

  /**
   * Envía una petición JSON-RPC al servidor con timeout.
   * Se usa internamente por listTools/callTool/ensureReady.
   * @param {string} method
   * @param {any} params
   * @param {{timeoutMs?:number}} [opts]
   * @returns {Promise<any>}
   */
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

  // Comprueba que el servidor responde listando herramientas. Se reintenta una vez
  // por si el framing inicial todavía no está asentado.
  async ensureReady() {
    try {
      await this.rpc('tools/list', undefined, { timeoutMs: 10_000 });
    } catch {
      await this.rpc('tools/list', undefined, { timeoutMs: 10_000 });
    }
    return true;
  }

  // Marca la instancia como recientemente usada (para el TTL de inactividad).
  _touch() {
    this.lastUsedAt = Date.now();
  }

  // Activa un intervalo que apaga el proceso si supera el TTL de inactividad.
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

  // Desactiva el intervalo de inactividad si está activo.
  _clearIdle() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ---------------- Registry (un ServerProcess por nombre lógico) ----------------
//
// Se mantiene un mapa {name → ServerProcess}. Cuando se pide un servidor, se
// consulta la configuración declarativa (mcp.servers.js), se resuelve el cwd y
// se instancia la clase si aún no existe.

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

  // Se resuelve el cwd por si contiene rutas relativas.
  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();

  inst = new ServerProcess(name, { cmdLine, cwd: resolvedCwd, env });
  servers.set(name, inst);
  return inst;
}

// --------------------------------- API pública ---------------------------------

/**
 * Garantiza que el servidor indicado está arrancado y responde.
 * @param {string} [serverName='auditor']
 * @returns {Promise<boolean>}
 */
export async function ensureReady(serverName = DEFAULT_SERVER) {
  const s = getOrCreateServer(serverName);
  await s.ensureReady();
  return true;
}

/**
 * Devuelve la lista de herramientas expuestas por el servidor MCP.
 * @param {string} [serverName='auditor']
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<Array<{name:string, description?:string, input_schema?:any}>>}
 */
export async function listTools(serverName = DEFAULT_SERVER, { timeoutMs } = {}) {
  const s = getOrCreateServer(serverName);
  const res = await s.rpc('tools/list', undefined, { timeoutMs });
  if (res && Array.isArray(res.tools)) return res.tools;
  if (Array.isArray(res)) return res;
  return [];
}

/**
 * Invoca una herramienta JSON-RPC en el servidor MCP indicado.
 * Se encarga de formatear la llamada `tools/call` y normalizar el resultado.
 * @param {string} serverName
 * @param {string} toolName
 * @param {object} [args={}]
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<any>} resultado de la herramienta (normalizado)
 */
export async function callTool(serverName, toolName, args = {}, { timeoutMs } = {}) {
  if (!serverName) throw new Error('callTool: serverName is required');
  if (!toolName) throw new Error('callTool: toolName is required');

  const s = getOrCreateServer(serverName);
  const result = await s.rpc(
    'tools/call',
    { name: toolName, arguments: args },
    { timeoutMs }
  );
  // Algunos servidores devuelven { name, result }, otros { result } o directamente el output.
  return result?.result ?? result;
}

/**
 * Atajo específico para el MCP "auditor" (Bevstack).
 * Valida la URL y llama a la herramienta `audit_site`.
 * @param {string} url
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<{overallPass:boolean, overallScore:number, pages:any[]}>}
 */
export async function auditSite(url, { timeoutMs } = {}) {
  if (!validHttpUrl(url)) {
    throw new Error(`Invalid URL for audit: "${url}"`);
  }
  const out = await callTool('auditor', 'audit_site', { url }, { timeoutMs });
  if (!out || typeof out !== 'object') {
    throw new Error('Invalid audit response from MCP');
  }
  return out; // Se espera { overallPass, overallScore, pages: [...] }
}

/**
 * Detiene todos los procesos hijos y limpia el registro.
 * Útil en hot-reload de desarrollo o al cerrar la app.
 */
export function closeAll() {
  for (const s of servers.values()) {
    s.stop();
  }
  servers.clear();
}

// --------------------------------- Utilidades ---------------------------------

// Comprueba si una cadena es una URL http(s) válida.
// Se usa para proteger las llamadas de usuario antes de invocar el MCP.
function validHttpUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}