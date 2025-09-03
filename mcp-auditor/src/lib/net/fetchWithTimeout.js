// Fetch robusto para HTML con:
//  - Headers realistas (evita bloqueos básicos)
//  - Timeout con AbortController
//  - Retries para errores transitorios (timeout / red)
//  - Límite de tamaño por streaming (no lee más de maxBytes)

import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

function buildHeaders(userAgent) {
  return {
    'User-Agent': userAgent || DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

/**
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   userAgent?: string,
 *   maxBytes?: number,
 *   retries?: number,
 * }} [opts]
 * @returns {Promise<{ text: string, status: number, finalUrl: string }>}
 */
export async function fetchHtml(url, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 20000; // 20s por defecto
  const maxBytes  = Number.isFinite(opts.maxBytes)  ? opts.maxBytes  : 2_000_000; // 2 MB
  const retries   = Number.isFinite(opts.retries)   ? opts.retries   : 2;   // 2 reintentos
  const ua        = opts.userAgent || DEFAULT_UA;

  /** @param {number} attempt */
  async function once(attempt) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        // compresión la maneja Node fetch automáticamente
        headers: buildHeaders(ua),
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        // homogeneiza el mensaje que espera el caller
        throw new Error(`Upstream responded ${res.status}`);
      }

      let text = '';
      const decoder = new TextDecoder();
      let read = 0;

      // Web Streams (WHATWG) en Node 18+ / 22
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.byteLength) {
            read += value.byteLength;
            const remaining = maxBytes - (read - value.byteLength);
            if (remaining <= 0) {
              // ya alcanzo el límite con el chunk anterior
              break;
            }
            // corta el chunk si excede
            const slice = remaining < value.byteLength ? value.subarray(0, remaining) : value;
            text += decoder.decode(slice, { stream: true });
            if (slice.byteLength < value.byteLength) break; // alcanza límite
          }
        }
        text += decoder.decode(); // flush
      } else {
        // Fallback 
        const t = await res.text();
        text = t.slice(0, maxBytes);
      }

      return { text, status: res.status, finalUrl: res.url || url };
    } catch (err) {
      clearTimeout(timer);
      // AbortError  timeout
      const msg = String(err?.message || err);
      if (msg.includes('The operation was aborted') || msg.includes('aborted')) {
        throw new Error('Fetch timeout');
      }
      // Propaga tal cual para que el caller distinga "Upstream responded X"
      throw err;
    }
  }

  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await once(i);
    } catch (err) {
      const msg = String(err?.message || err);
      lastErr = err;
      // Solo reintentar en errores transitorios típicos
      const transient = /timeout|aborted|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
      if (!transient || i === retries) break;
      // pequeño backoff
      await delay(250 * (i + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

export default { fetchHtml };