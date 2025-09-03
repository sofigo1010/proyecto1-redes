// examples/node-client/index.js
// Cliente mínimo MCP por stdio (NDJSON). Spawnea el bin local del repo.
// Uso: node index.js https://tu-sitio.com

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config: cómo lanzar el server MCP ---
const BIN_LOCAL = path.resolve(__dirname, '../../bin/mcp-auditor.js');
const SERVER_CMD = process.env.MCP_SERVER_CMD || process.execPath;
const SERVER_ARGS = process.env.MCP_SERVER_CMD
  ? []
  : [BIN_LOCAL]; // node ../../bin/mcp-auditor.js

// URL objetivo (CLI arg o default)
const targetUrl = process.argv[2] || 'https://example.com';

// --- Lanzar el server ---
const child = spawn(SERVER_CMD, SERVER_ARGS, {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

child.on('error', (e) => {
  console.error('[client] Failed to spawn server:', e);
  process.exit(1);
});

child.on('exit', (code, sig) => {
  console.error(`[client] server exited code=${code} sig=${sig || ''}`);
});

// --- JSON-RPC (NDJSON) ---
let nextId = 1;
const pending = new Map();

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // timeout 
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }
    }, 15000);
  });
}

const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0') return;

  const { id, result, error } = msg;
  if (id != null && pending.has(id)) {
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (error) reject(Object.assign(new Error(error.message || 'RPC Error'), { code: error.code, data: error.data }));
    else resolve(result);
  }
});

// --- Flujo de ejemplo ---
(async () => {
  try {
    console.error('[client] ping…');
    await send('ping', {});

    console.error('[client] list tools…');
    const listed = await send('tools/list', {});
    const names = (listed.tools || []).map(t => t.name);
    console.error('[client] tools:', names.join(', ') || '(none)');

    if (!names.includes('audit_site')) {
      throw new Error('Tool audit_site no está disponible');
    }

    console.error('[client] calling audit_site:', targetUrl);
    const { result } = await send('tools/call', {
      name: 'audit_site',
      arguments: { url: targetUrl },
    });

    // Mostrar salida bonita
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[client] error:', err?.stack || err);
    process.exitCode = 1;
  } finally {
    // Cerrar stdio para que el server termine
    try { child.stdin.end(); } catch {}
  }
})();