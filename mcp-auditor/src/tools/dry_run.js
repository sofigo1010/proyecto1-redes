// src/tools/dry_run.js
// Tool MCP: dry_run
// Descubre candidatos (links) y headings del home SIN calcular similitud ni spellcheck.
// Input:  { url: string }
// Output: { candidates: string[], headings: string[] }

import { loadEnvConfig } from '../config/env.js';
import { fetchHtml } from '../lib/net/fetchWithTimeout.js';
import { resolveCandidates } from '../lib/net/resolveCandidates.js';
import { extractHeadings } from '../lib/sections/extractHeadings.js';

/**
 * @param {{ url:string }} args
 * @param {{ log?:(level:string,...args:any[])=>void, manifest?:any }} ctx
 */
export default async function dryRunTool(args, { log }) {
  const url = sanitizeUrl(args?.url);
  if (!url) {
    return { candidates: [], headings: [] };
  }

  const env = loadEnvConfig();
  let homeHtml = '';
  let origin = '';

  try {
    const u = new URL(url);
    origin = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}/`;
  } catch {
    return { candidates: [], headings: [] };
  }

  try {
    const { text } = await fetchHtml(url, {
      timeoutMs: env.TIMEOUT_MS,
      userAgent: env.USER_AGENT,
      maxBytes: env.MAX_HTML_SIZE_BYTES,
    });
    homeHtml = text || '';
  } catch (err) {
    log?.('warn', 'dry_run: fetch home failed:', err?.message || err);
    // Continuamos: sin HTML del home aún podemos proponer tails directos.
  }

  // 1) Candidatos por tipo (same host por defecto)
  const byType = resolveCandidates(origin, homeHtml, { CANDIDATE_TAILS: env.CANDIDATE_TAILS }, { sameHostOnly: true });
  const candidates = dedupe([...byType.privacy, ...byType.terms, ...byType.faq]);

  // 2) Headings del home
  const headings = extractHeadings(homeHtml || '', {
    minLevel: 1,
    maxLevel: 3,
    dedupe: true,
    maxItems: 300,
    includeTitle: true,
  });

  return { candidates, headings };
}

function sanitizeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}