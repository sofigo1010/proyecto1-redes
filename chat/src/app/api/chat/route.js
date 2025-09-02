export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import {
  auditSite,
  ensureReady as ensureMcp,     // acepta "auditor" o nada (compat)
  runTool,                       // genérico multi-MCP
} from '../../../lib/mcp/facade.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-20241022';
const TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? 0.7);
const MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 1024);
const STREAMING = String(process.env.AI_STREAMING ?? 'true').toLowerCase() === 'true';

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  'You are a helpful, concise assistant. If any MCP_* blocks are present, use them as primary evidence to produce a succinct, user-friendly answer with findings, risks, and concrete fixes. Prefer bullets, short paragraphs, and clear next steps.';

// ---------------------- Intent & URL helpers ----------------------

const SLASH_AUDIT_RE = /^\/audit\s+(\S+)/i;
// /mcp <server> <tool> <json?>
const SLASH_MCP_RE = /^\/mcp\s+([a-z0-9_-]+)\s+([a-z0-9_.-]+)(?:\s+([\s\S]+))?$/i;

function normalizeMessages(body) {
  if (Array.isArray(body?.messages) && body.messages.length > 0) {
    return body.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
    }));
  }
  const content = String(body?.content ?? '').trim();
  return content ? [{ role: 'user', content }] : [];
}

// 1) Slash command: /audit <url>
function detectAuditSlash(text) {
  const m = String(text || '').trim().match(SLASH_AUDIT_RE);
  if (!m) return null;
  return validHttpUrl(m[1]) ? m[1] : null;
}

// 2) Generic slash: /mcp <server> <tool> <json?>
function detectMcpSlash(text) {
  const m = String(text || '').trim().match(SLASH_MCP_RE);
  if (!m) return null;
  const [, server, tool, jsonLike] = m;
  let args = {};
  if (jsonLike && jsonLike.trim()) {
    try { args = JSON.parse(jsonLike); } catch { /* ignore parse errors */ }
  }
  return { server, tool, args };
}

// 3) NL intent para Bevstack auditor
function detectAuditNL(messages, lastUserText) {
  const url =
    extractFirstUrl(lastUserText) ||
    findLastUrlInHistory(messages) ||
    null;
  if (!url) return null;

  const t = String(lastUserText || '').toLowerCase();

  const verbs = /\b(audit|auditar|auditor[ií]a|aud[ií]tame|audita|analiza|revisa|verifica|eval[uú]a|checa|check)\b/;
  const compliance = /\b(cumple|cumplimiento|compliance|match|compar(a|e)|similaridad|similarity|score|plantillas?|templates?)\b/;
  const policyWords = /\b(privacidad|privacy|pol[ií]tica|policy|t[ée]rminos|terms|tos|faq|soporte|ayuda|customer\s*support)\b/;
  const brand = /\bbevstack\b/;

  let score = 0;
  if (verbs.test(t)) score += 1;
  if (compliance.test(t)) score += 1;
  if (policyWords.test(t)) score += 1;
  if (brand.test(t)) score += 1;

  return score >= 2 ? url : null;
}

function extractFirstUrl(text) {
  const re = /(https?:\/\/[^\s)>'"}\]]+)/i;
  const m = String(text || '').match(re);
  return validHttpUrl(m?.[1]) ? m[1] : null;
}

function findLastUrlInHistory(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = extractFirstUrl(messages[i]?.content);
    if (u) return u;
  }
  return null;
}

function validHttpUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------- POST handler ----------------------

export async function POST(req) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messagesIn = normalizeMessages(body);
  if (messagesIn.length === 0) {
    return NextResponse.json({ error: 'Empty input. Provide {content} or {messages}.' }, { status: 400 });
  }

  const lastUser = [...messagesIn].reverse().find(m => m.role === 'user');
  const userText = lastUser?.content || '';

  // ---- Multi-MCP orchestration ----
  // 1) /mcp … → ejecución directa del MCP indicado
  // 2) /audit <url> o intención NL → auditor (Bevstack)
  const mcpBlocks = [];
  const mcpSlash = detectMcpSlash(userText);

  if (mcpSlash) {
    const { server, tool, args } = mcpSlash;
    try {
      await ensureMcp(server);
      const result = typeof runTool === 'function'
        ? await runTool(server, tool, args)
        : await fallbackRun(server, tool, args);
      const { summary, raw } = summarizeGeneric(server, tool, result);
      mcpBlocks.push({ tag: `${server}.${tool}`, summary, raw });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: 'MCP call failed', details: msg, server, tool }, { status: 502 });
    }
  } else {
    const auditUrl =
      detectAuditSlash(userText) ||
      detectAuditNL(messagesIn, userText) ||
      null;

    if (auditUrl) {
      try {
        await ensureMcp('auditor');
        const report = await auditSite(auditUrl, {
          timeoutMs: Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 30_000),
        });
        const { summary, raw } = summarizeAudit('auditor', 'audit_site', report, auditUrl);
        mcpBlocks.push({ tag: 'auditor.audit_site', summary, raw });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: 'MCP audit failed', details: msg }, { status: 502 });
      }
    }
  }

  // Incrusta los bloques MCP (si existen) en el último mensaje del usuario
  const augmentedUserContent = embedMcpBlocks(userText, mcpBlocks);

  // Construye payload de Anthropic (permite overrides por request)
  const outMessages = buildOutgoingMessages(messagesIn, augmentedUserContent, mcpBlocks.length > 0);
  const payload = {
    model: (typeof body?.model === 'string' && body.model) ? body.model : MODEL,
    temperature: Number.isFinite(Number(body?.temperature)) ? Number(body.temperature) : TEMPERATURE,
    max_tokens: Number.isFinite(Number(body?.max_tokens)) ? Number(body.max_tokens) : MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: outMessages,
    stream: STREAMING,
  };

  // Llama a Anthropic (stream NDJSON)
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: anthropicHeaders(),
      body: JSON.stringify(payload),
    });

    // === NO STREAMING ===
    if (!STREAMING) {
      if (!res.ok) {
        const errTxt = await safeText(res);
        return NextResponse.json(
          { error: `Anthropic error: ${res.status}`, details: safeJson(errTxt) ?? errTxt },
          { status: 502 }
        );
      }
      // DEVOLVER JSON CRUDO DE ANTHROPIC para que useChat() pueda leer content[].
      const json = await res.json();
      return NextResponse.json(json);
    }

    // === STREAMING (NDJSON) ===
    if (!res.ok || !res.body) {
      const errTxt = await safeText(res);
      return NextResponse.json(
        { error: `Anthropic error: ${res.status}`, details: safeJson(errTxt) ?? errTxt },
        { status: 502 }
      );
    }

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const dec = new TextDecoder();
        let buffer = '';
        const reader = res.body.getReader();

        (async function pump() {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += dec.decode(value, { stream: true });

              let idx;
              while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trimEnd();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                if (!line.startsWith('data:')) continue;

                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;

                try {
                  const evt = JSON.parse(data);
                  if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                    const chunk = evt.delta?.text || '';
                    if (chunk) controller.enqueue(enc.encode(JSON.stringify({ type: 'delta', text: chunk }) + '\n'));
                  } else if (evt.type === 'message_delta' && evt.delta?.type === 'text_delta') {
                    const chunk = evt.delta?.text || '';
                    if (chunk) controller.enqueue(enc.encode(JSON.stringify({ type: 'delta', text: chunk }) + '\n'));
                  } else if (evt.type === 'error') {
                    controller.enqueue(enc.encode(JSON.stringify({ type: 'error', error: evt.error?.message || 'upstream error' }) + '\n'));
                  }
                } catch {
                  // línea malformada, se ignora
                }
              }
            }
          } catch (err) {
            controller.enqueue(enc.encode(JSON.stringify({ type: 'error', error: String(err?.message || err) }) + '\n'));
          } finally {
            controller.enqueue(enc.encode(JSON.stringify({ type: 'done' }) + '\n'));
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Upstream request failed', details: msg }, { status: 502 });
  }
}

// ---------------------- Anthropic helpers ----------------------

function anthropicHeaders() {
  return {
    'content-type': 'application/json',
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
  };
}

function extractText(json) {
  try {
    const parts = json?.content || [];
    return parts
      .filter(p => p?.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('') || '';
  } catch {
    return '';
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
function safeJson(txt) {
  try { return JSON.parse(txt); } catch { return null; }
}
function safeJsonString(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return '{}'; }
}

// ---------------------- Prompt building ----------------------

function buildOutgoingMessages(original, augmentedUserText, hadMcpBlocks) {
  if (!hadMcpBlocks) return original;
  const out = [...original];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      out[i] = { role: 'user', content: augmentedUserText };
      break;
    }
  }
  return out;
}

function embedMcpBlocks(userText, blocks = []) {
  if (!blocks.length) return userText;

  const MAX_JSON_CHARS = 70_000;
  const parts = [userText, ''];

  for (const b of blocks) {
    const rawJson = b.raw.length > MAX_JSON_CHARS ? b.raw.slice(0, MAX_JSON_CHARS) + '\n/* truncated */' : b.raw;
    parts.push(
      `MCP_${b.tag} (summary):`,
      '```text',
      b.summary,
      '```',
      '',
      `MCP_${b.tag}_JSON (verbatim):`,
      '```json',
      rawJson,
      '```',
      ''
    );
  }

  parts.push('Please analyze the MCP results above: explain findings, risks, and propose clear, actionable fixes (bulleted). Keep it concise and friendly.');
  return parts.join('\n');
}

// ---------------------- MCP result summarizers ----------------------

function summarizeAudit(server, tool, report, url) {
  const pct = formatScore(report?.overallScore);
  const head = `Audit for ${url} [${server}.${tool}]\nOverall: ${report?.overallPass ? 'PASS' : 'FAIL'} (score ${pct})`;
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const lines = pages.map((p) => {
    const sim = p?.similarity != null ? `${p.similarity}` : '—';
    const miss = (p?.sectionsMissing || []).length;
    const at = p?.foundAt ? ` → ${p.foundAt}` : p?.error ? ` → ${p.error}` : '';
    const missingList =
      miss > 0
        ? `; missing: ${p.sectionsMissing.slice(0, 6).join(', ')}${miss > 6 ? '…' : ''}`
        : '';
    return `- ${cap(p?.type || 'page')}: ${p?.pass ? 'PASS' : 'FAIL'} (sim ${sim}, miss ${miss})${at}${missingList}`;
  });

  return {
    summary: [head, ...lines].join('\n'),
    raw: safeJsonString(report),
  };
}

function summarizeGeneric(server, tool, result) {
  const json = safeJsonString(result);
  let keys = [];
  try { keys = Object.keys(result || {}); } catch {}
  const head = `Result from ${server}.${tool}: ${keys.length ? 'keys=' + keys.join(', ') : 'no keys'}.`;
  return { summary: head, raw: json };
}

// ---------------------- Small utils ----------------------

function formatScore(s) {
  if (typeof s === 'number') {
    const pct = s > 1 ? s : s * 100;
    return `${Math.round(pct)}%`;
  }
  return '—';
}
function cap(x) {
  const s = String(x || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function fallbackRun(server, tool, args) {
  if (server === 'auditor' && tool === 'audit_site' && args?.url) {
    return auditSite(args.url, { timeoutMs: Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 30_000) });
  }
  throw new Error('runTool not available in facade; please add it for multi-MCP.');
}