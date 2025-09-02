export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auditSite, ensureReady as ensureMcp } from '../../../lib/mcp/facade.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-20241022';
const TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? 0.7);
const MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 1024);
const STREAMING = String(process.env.AI_STREAMING ?? 'true').toLowerCase() === 'true';

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  'You are a helpful, concise assistant. If MCP_AUDIT is present, use it as primary evidence to produce a succinct, user-friendly report with findings, risks, and concrete fixes. Prefer bullets, short paragraphs, and clear next steps.';

// ---------------------- Intent & URL helpers ----------------------

const SLASH_AUDIT_RE = /^\/audit\s+(\S+)/i;

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

// 2) NL intent: busca URL y señales léxicas en español/inglés.
function detectAuditNL(messages, lastUserText) {
  const url =
    extractFirstUrl(lastUserText) ||
    findLastUrlInHistory(messages) ||
    null;
  if (!url) return null;

  const t = String(lastUserText || '').toLowerCase();

  // Señales de intención
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
  // quick guard for missing key
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

  // Intención de auditoría: slash o lenguaje natural
  let auditUrl =
    detectAuditSlash(userText) ||
    detectAuditNL(messagesIn, userText) ||
    null;

  // Si hay intención de auditoría, invoca MCP y embebe reporte en el prompt
  let augmentedUserContent = userText;

  if (auditUrl) {
    try {
      await ensureMcp(); // multi-MCP ready (auditor por defecto)
      const report = await auditSite(auditUrl, {
        timeoutMs: Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 30_000),
      });

      const summary = summarizeReport(report, auditUrl);
      let rawJson = safeJsonString(report);
      const MAX_JSON_CHARS = 70_000;
      if (rawJson.length > MAX_JSON_CHARS) {
        rawJson = rawJson.slice(0, MAX_JSON_CHARS) + '\n/* truncated */';
      }

      augmentedUserContent = [
        userText,
        '',
        'MCP_AUDIT (summary):',
        '```text',
        summary,
        '```',
        '',
        'MCP_AUDIT_JSON (verbatim):',
        '```json',
        rawJson,
        '```',
        '',
        'Please analyze the audit: explain findings, risks, and propose clear, actionable fixes (bulleted). Keep it concise and friendly.',
      ].join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: 'MCP audit failed', details: msg }, { status: 502 });
    }
  }

  // Construye payload de Anthropic (permite override opcional por request)
  const outMessages = buildOutgoingMessages(messagesIn, augmentedUserContent, !!auditUrl);
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

    if (!STREAMING) {
      if (!res.ok) {
        const errTxt = await safeText(res);
        return NextResponse.json(
          { error: `Anthropic error: ${res.status}`, details: safeJson(errTxt) ?? errTxt },
          { status: 502 }
        );
      }
      const json = await res.json();
      return NextResponse.json({ text: extractText(json) });
    }

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
                  // Tolerante a varios tipos de evento del Messages API
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
                  // swallow malformed line
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

function buildOutgoingMessages(original, augmentedUserText, hadAudit) {
  if (!hadAudit) return original;
  const out = [...original];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      out[i] = { role: 'user', content: augmentedUserText };
      break;
    }
  }
  return out;
}

// ---------------------- Audit summarizer ----------------------

function summarizeReport(report, url) {
  const pct = formatScore(report?.overallScore);
  const head = `Audit for ${url}\nOverall: ${report?.overallPass ? 'PASS' : 'FAIL'} (score ${pct})`;
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
  return [head, ...lines].join('\n');
}

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