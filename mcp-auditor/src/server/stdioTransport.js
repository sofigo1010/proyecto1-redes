// Transporte JSON-RPC 2.0 sobre stdio con framing dual:
//  - NDJSON (una línea por mensaje JSON)
//  - LSP-style: "Content-Length: <n>\r\n\r\n<json>"
// Auto-detecta el framing por el primer chunk y lo mantiene en las respuestas.

import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';

const FRAMING = {
  UNKNOWN: 'unknown',
  NDJSON: 'ndjson',
  LSP: 'lsp',
};

/** Escribe un mensaje NDJSON directo (para tests). */
function writeJsonRpc(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * Adjunta el servidor MCP a STDIN/STDOUT y procesa JSON-RPC.
 * @param {{handleRequest: (payload:any)=>Promise<any>, shutdown?:()=>Promise<void>}} server
 * @param {{onClose?: ()=>void, log?: (level:string, ...args:any[])=>void}} opts
 * @returns {()=>void} detach
 */
export function attachToStdio(server, opts = {}) {
  const log = opts.log || ((..._args) => {});
  let framing = FRAMING.UNKNOWN;

  // Promesas en vuelo (dispatch) para esperar antes de apagar
  const pending = new Set();

  // --- Escritura (usa el framing detectado) ---
  function writeMessage(obj) {
    try {
      const json = JSON.stringify(obj);
      if (framing === FRAMING.LSP) {
        const body = Buffer.from(json, 'utf8');
        const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
        const out = Buffer.concat([header, body]);
        process.stdout.write(out);
        log('debug', '[tx LSP]', `len=${body.length}`, json.slice(0, 200));
      } else {
        // NDJSON por defecto
        process.stdout.write(json + '\n');
        log('debug', '[tx NDJSON]', json.slice(0, 200));
      }
    } catch (e) {
      log('error', 'writeMessage error:', e?.stack || e);
    }
  }

  // --- Parser NDJSON ---
  let ndjsonBuffer = '';
  function tryDrainNdjson() {
    let newlineIdx;
    while ((newlineIdx = ndjsonBuffer.indexOf('\n')) >= 0) {
      const line = ndjsonBuffer.slice(0, newlineIdx);
      ndjsonBuffer = ndjsonBuffer.slice(newlineIdx + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      log('debug', '[rx NDJSON line]', trimmed.slice(0, 200));
      handleOneLine(trimmed); 
    }
  }
  function handleOneLine(line) {
    try {
      const payload = JSON.parse(line);
      const p = dispatch(payload);
      pending.add(p);
      p.finally(() => pending.delete(p));
      return p;
    } catch (e) {
      log('warn', 'Invalid NDJSON line (ignored):', e?.message);
      return Promise.resolve();
    }
  }

  // Parser LSP 
  let lspBuffer = Buffer.alloc(0);
  function tryDrainLsp() {
    // Busca doble CRLF que separa headers del cuerpo
    while (true) {
      const headerEnd = lspBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return; // headers incompletos
      const headerPart = lspBuffer.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(headerPart);
      if (!m) {
        log('warn', 'LSP header without Content-Length; dropping header chunk');
        lspBuffer = lspBuffer.slice(headerEnd + 4);
        continue;
      }
      const length = parseInt(m[1], 10);
      const totalNeeded = headerEnd + 4 + length;
      if (lspBuffer.length < totalNeeded) return; // cuerpo incompleto

      const body = lspBuffer.slice(headerEnd + 4, totalNeeded).toString('utf8');
      lspBuffer = lspBuffer.slice(totalNeeded);

      try {
        log('debug', '[rx LSP body]', body.slice(0, 200));
        const payload = JSON.parse(body);
        const p = dispatch(payload);
        pending.add(p);
        p.finally(() => pending.delete(p));
      } catch (e) {
        log('warn', 'Invalid LSP JSON (ignored):', e?.message);
      }
      // loop para ver si hay más mensajes completos
    }
  }

  // --- Despacho hacia el server JSON-RPC ---
  async function dispatch(payload) {
    const id = payload && typeof payload === 'object' ? payload.id ?? null : null;
    try {
      log('debug', '[dispatch] IN', 'id=', id, 'method=', payload?.method);
      const res = await server.handleRequest(payload);
      if (res) {
        writeMessage(res);
        log('debug', '[dispatch] OUT', 'id=', id, 'ok');
      } else {
        log('debug', '[dispatch] OUT', 'id=', id, 'empty result (ignored)');
      }
    } catch (err) {
      // Si el server lanzó una excepción no convertida en JSON-RPC, devuelve error genérico
      writeMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'Internal error' },
      });
      log('error', 'dispatch error:', err?.stack || err);
    }
  }

  // --- Auto-detector de framing y handler de datos ---
  function onData(chunk) {
    // Asegura Buffer para operaciones binarias (LSP)
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');

    if (framing === FRAMING.UNKNOWN) {
      // Detecta framing desde el primer mensaje
      const s = buf.toString('utf8');
      if (/^\s*Content-Length:/i.test(s) || s.includes('\r\n\r\n')) {
        framing = FRAMING.LSP;
      } else {
        framing = FRAMING.NDJSON;
      }
      log('debug', 'Framing detected:', framing);
    }

    if (framing === FRAMING.LSP) {
      lspBuffer = Buffer.concat([lspBuffer, buf]);
      tryDrainLsp();
    } else {
      ndjsonBuffer += buf.toString('utf8');
      tryDrainNdjson();
    }
  }

  // --- Wire up STDIN events ---
  process.stdin.on('data', onData);

  process.stdin.on('end', async () => {
    try {
      console.error('[info] STDIO closed, shutting down.');

      try {
        if (framing === FRAMING.NDJSON) {
          const tail = ndjsonBuffer;
          ndjsonBuffer = '';
          if (tail && tail.trim().length) {
            log('debug', '[end] NDJSON tail detected, processing…');
            await handleOneLine(tail);
          }
        } else if (framing === FRAMING.LSP) {
          log('debug', '[end] tryDrainLsp() on end');
          tryDrainLsp();
        }
      } catch (e) {
        console.error('[warn] drain-on-end error:', e?.message || e);
      }

      // 1bis) Esperar cualquier dispatch ya en vuelo (lanzado por tryDrain*)
      if (pending.size) {
        log('debug', `[end] awaiting ${pending.size} pending dispatch(es)…`);
        await Promise.all([...pending]);
      }

      // 2) Cede un tick para que dispatch() programe los writes pendientes
      await new Promise((r) => setImmediate(r));

      // 3) Asegura flush de STDOUT antes de cerrar
      await new Promise((resolve) => process.stdout.write('', () => resolve()));

      // 4) Apaga el server
      await server.shutdown?.();
    } catch (e) {
      console.error('[warn] shutdown error:', e?.stack || e);
    } finally {
      opts.onClose?.();
      process.exit(0);
    }
  });

  process.stdin.on('error', async (e) => {
    log('error', 'STDIN error:', e?.stack || e);
    try {
      await server.shutdown?.();
    } finally {
      opts.onClose?.();
    }
  });

  return function detach() {
    try {
      process.stdin.off('data', onData);
    } catch (_) {}
    server.shutdown?.().catch(() => {});
  };
}

export default attachToStdio;