export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import {
  auditSite,
  ensureReady as ensureMcp,
  runTool,
  listTools,
} from '../../../lib/mcp/facade.js';
import path from 'node:path';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-20241022';
const TEMPERATURE = Number(process.env.AI_TEMPERATURE ?? 0.7);
const MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 1024);
const STREAMING = String(process.env.AI_STREAMING ?? 'true').toLowerCase() === 'true';

const BYPASS_ON_MCP = String(process.env.AI_BYPASS_ON_MCP || '').toLowerCase() === 'true';
const FALLBACK_ON_ERR = String(process.env.AI_FALLBACK_ON_UPSTREAM_ERROR ?? 'true').toLowerCase() !== 'false';

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  'You are a helpful, concise assistant. If any MCP_* blocks are present, use them as primary evidence to produce a succinct, user-friendly answer with findings, risks, and concrete fixes. Prefer bullets, short paragraphs, and clear next steps.';

// ---------------------- Intent helpers ----------------------

const SLASH_AUDIT_RE = /^\/audit\s+(\S+)/i;
const SLASH_MCP_RE = /^\/mcp\s+([a-z0-9_-]+)\s+([a-z0-9_.\/-]+)(?:\s+([\s\S]+))?$/i;

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

function detectAuditSlash(text) {
  const m = String(text || '').trim().match(SLASH_AUDIT_RE);
  if (!m) return null;
  return validHttpUrl(m[1]) ? m[1] : null;
}

function detectMcpSlash(text) {
  const m = String(text || '').trim().match(SLASH_MCP_RE);
  if (!m) return null;
  const [, server, tool, jsonLike] = m;
  let args = {};
  if (jsonLike && jsonLike.trim()) {
    try { args = JSON.parse(jsonLike); } catch {}
  }
  return { server, tool, args };
}

// Auditor NL
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
  try { const url = new URL(String(u)); return url.protocol === 'http:' || url.protocol === 'https:'; }
  catch { return false; }
}

// ---------------------- NL intents Git/FS ----------------------

const GIT_BOOTSTRAP_PATTERNS = [
  /\bcrea(?:r)?\s+un\s+repositorio\s+(?:llamado|nombrado)\s+([a-z0-9._\-\/]+)\b[\s\S]*?\bagrega?\s+un\s+readme\b[\s\S]*?\bque\s+diga\s+["'“”]?([\s\S]+?)["'“”]?(?:\s+y\s+haga?\s+el?\s+commit|\s*y\s+haz\s+commit|\s*haz\s+commit|\s*$)/i,
  /\bcreate\s+(?:a\s+)?repo(?:sitory)?\s+(?:named|called)\s+([a-z0-9._\-\/]+)\b[\s\S]*?\badd\s+(?:a\s+)?readme\b[\s\S]*?\bsay(?:s)?\s+["'“”]?([\s\S]+?)["'“”]?(?:\s+and\s+commit|\s*$)/i,
];
function detectGitBootstrap(text) {
  const t = String(text || '');
  for (const re of GIT_BOOTSTRAP_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const name = (m[1] || '').trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
      const readmeText = String(m[2] || '').trim();
      if (name && readmeText) return { repoName: name, readmeText };
    }
  }
  return null;
}

const ROOT_README_PATTERNS = [
  /\bcrea(?:r)?\s+un\s+readme\b[\s\S]*?\b(en\s+el\s+root|en\s+la\s+ra[ií]z|root\s+del\s+repo|root\s+del\s+repositorio)\b[\s\S]*?\b(que\s+diga|con\s+contenido)\s+["'“”]?([\s\S]+?)["'“”]?\s*$/i,
  /\bcreate\s+(?:a\s+)?readme\b[\s\S]*?\b(in\s+the\s+root|at\s+repo\s+root)\b[\s\S]*?\b(say|with)\s+["'“”]?([\s\S]+?)["'“”]?\s*$/i,
];
function detectRootReadme(text) {
  const t = String(text || '');
  for (const re of ROOT_README_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const readmeText = String(m[3] || '').trim();
      if (readmeText) return { readmeText };
    }
  }
  return null;
}

const FS_ROOTS_PATTERNS = [
  /\b(cu[aá]les?|que)\s+son\s+mis\s+directorios\s+permitidos\b/i,
  /\bwhat\s+are\s+my\s+(allowed\s+)?directories\b/i,
];
function detectFsRootsQuestion(text) {
  const t = String(text || '');
  return FS_ROOTS_PATTERNS.some(re => re.test(t));
}
function filesystemAllowedRoots() {
  const args = (process.env.MCP_filesystem_ARGS || '..').trim();
  const parts = args ? args.split(/\s+/).filter(Boolean) : ['..'];
  const resolved = parts.map(p => ({ arg: p, abs: path.resolve(process.cwd(), p) }));
  return { parts, resolved };
}

// ---------------------- Tools discovery ----------------------

async function pickTool(server, candidates) {
  const tools = await listTools(server).catch(() => []);
  const names = new Set((tools || []).map(t => t?.name).filter(Boolean));
  for (const c of candidates) if (names.has(c)) return c;
  throw new Error(`No matching tool in ${server}: tried [${candidates.join(', ')}]`);
}

// ---------------------- Robust calls (arg variants) ----------------------

async function tryFsWriteFile(tool, filePath, text) {
  const TRY = [
    { path: filePath, content: text },
    { path: filePath, contents: text },
    { filepath: filePath, content: text },
    { path: filePath, data: text },
    { path: filePath, text },
  ];
  for (const args of TRY) {
    try { return await runTool('filesystem', tool, args); } catch {}
  }
  throw new Error(`filesystem write failed for ${filePath}`);
}

async function tryFsMkdirp(tool, dirPath) {
  // intenta variantes comunes de mkdir -p
  const TRY = [
    { path: dirPath, parents: true },
    { path: dirPath, recursive: true },
    { dir: dirPath, recursive: true },
    { path: dirPath },
  ];
  for (const args of TRY) {
    try { return await runTool('filesystem', tool, args); } catch {}
  }
  // si no hay tool o todas fallan, dejamos que write_file falle con error claro
  throw new Error(`filesystem mkdir failed for ${dirPath}`);
}

async function tryGitAdd(tool, filePath) {
  const TRY = [
    { files: [filePath] },
    { paths: [filePath] },
    { pathspecs: [filePath] },
    { pattern: filePath },
    { pathspec: filePath },
  ];
  for (const args of TRY) {
    try { return await runTool('git', tool, args); } catch {}
  }
  try { return await runTool('git', tool, {}); } catch (e) {
    throw new Error(`git add failed for ${filePath}: ${e?.message || e}`);
  }
}

async function tryGitCommit(tool, message, filePath) {
  const TRY = [
    { message },
    { message, add_all: true },
    { message, all: true },
    filePath ? { message, paths: [filePath] } : null,
  ].filter(Boolean);
  for (const args of TRY) {
    try { return await runTool('git', tool, args); } catch {}
  }
  throw new Error(`git commit failed: ${message}`);
}

// ---------------------- Flows ----------------------

async function runGitBootstrapFlow({ repoName, readmeText }) {
  await ensureMcp('filesystem');
  await ensureMcp('git');

  const writeTool  = await pickTool('filesystem', ['write_file', 'save_file', 'write']);
  const addTool    = await pickTool('git',        ['git_add', 'add', 'stage']);
  const commitTool = await pickTool('git',        ['git_commit', 'commit']);

  const repoDir = repoName.replace(/\/+$/, '');
  const readmePath = `${repoDir}/README.md`;
  const commitMsg = `chore(${repoName}): add README`;

  const blocks = [];

  // mkdir -p del repo (si existe la tool)
  try {
    const mkdirTool = await pickTool('filesystem', ['create_directory', 'mkdir', 'make_directory']);
    const mkRes = await tryFsMkdirp(mkdirTool, repoDir);
    blocks.push(tagBlock('filesystem', mkdirTool, summarizeGeneric('filesystem', mkdirTool, mkRes)));
  } catch (e) {
    // No es fatal si no existe la tool; lo registramos como nota
    blocks.push(tagBlock('filesystem', 'mkdir?', summarizeGeneric('filesystem', 'mkdir?', { note: 'skip/unsupported', error: String(e?.message || '') })));
  }

  const wrRes = await tryFsWriteFile(writeTool, readmePath, String(readmeText)).catch(e => ({ error: String(e?.message || e) }));
  blocks.push(tagBlock('filesystem', writeTool, summarizeGeneric('filesystem', writeTool, wrRes)));

  const addRes = await tryGitAdd(addTool, readmePath).catch(e => ({ error: String(e?.message || e) }));
  blocks.push(tagBlock('git', addTool, summarizeGeneric('git', addTool, addRes)));

  const cmRes = await tryGitCommit(commitTool, commitMsg, readmePath).catch(e => ({ error: String(e?.message || e) }));
  blocks.push(tagBlock('git', commitTool, summarizeGeneric('git', commitTool, cmRes)));

  return { blocks, commitMsg };
}

async function runRootReadmeFlow({ readmeText }) {
  await ensureMcp('filesystem');
  await ensureMcp('git');

  const writeTool  = await pickTool('filesystem', ['write_file', 'save_file', 'write']);
  const addTool    = await pickTool('git',        ['git_add', 'add', 'stage']);
  const commitTool = await pickTool('git',        ['git_commit', 'commit']);

  const filePath = 'README.md';
  const commitMsg = `docs: add README`;

  const blocks = [];

  const wrRes = await tryFsWriteFile(writeTool, filePath, String(readmeText)).catch(e => ({ error: String(e?.message || e) }));
  blocks.push(tagBlock('filesystem', writeTool, summarizeGeneric('filesystem', writeTool, wrRes)));

  const addRes = await tryGitAdd(addTool, filePath).catch(e => ({ error: String(e?.message || e) }));
  blocks.push(tagBlock('git', addTool, summarizeGeneric('git', addTool, addRes)));

  const cmRes = await tryGitCommit(commitTool, commitMsg, filePath).catch(e => ({ error: String(e?.message || e) }));
  blocks.push(tagBlock('git', commitTool, summarizeGeneric('git', commitTool, cmRes)));

  return { blocks, commitMsg };
}

// ---------------------- POST handler ----------------------

export async function POST(req) {
  if (!API_KEY && !BYPASS_ON_MCP) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const messagesIn = normalizeMessages(body);
  if (messagesIn.length === 0) {
    return NextResponse.json({ error: 'Empty input. Provide {content} or {messages}.' }, { status: 400 });
  }

  const lastUser = [...messagesIn].reverse().find(m => m.role === 'user');
  const userText = lastUser?.content || '';

  const mcpBlocks = [];
  const mcpSlash = detectMcpSlash(userText);

  if (mcpSlash) {
    const { server, tool, args } = mcpSlash;
    try {
      await ensureMcp(server);

      // tools.list → usar listTools()
      if (tool === 'tools.list' || tool === 'tools/list' || tool === 'tools' || tool === 'list') {
        const tools = await listTools(server);
        const summary = [
          `Tools in "${server}" (${tools?.length ?? 0}):`,
          ...(tools || []).map(t => `- ${t?.name}${t?.description ? ' — ' + t.description : ''}`)
        ].join('\n');
        mcpBlocks.push({ tag: `${server}.tools_list`, summary, raw: safeJsonString(tools || []) });
      } else {
        const result = await runTool(server, tool, args);
        const { summary, raw } = summarizeGeneric(server, tool, result);
        mcpBlocks.push({ tag: `${server}.${tool}`, summary, raw });
      }
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
        const report = await auditSite(auditUrl, { timeoutMs: Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 30_000) });
        const { summary, raw } = summarizeAudit('auditor', 'audit_site', report, auditUrl);
        mcpBlocks.push({ tag: 'auditor.audit_site', summary, raw });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: 'MCP audit failed', details: msg }, { status: 502 });
      }
    } else {
      const gitNL = detectGitBootstrap(userText);
      if (gitNL) {
        try {
          const { blocks, commitMsg } = await runGitBootstrapFlow(gitNL);
          mcpBlocks.push(...blocks);
          const head = `Git/FS bootstrap sequence:\n- dir: ${gitNL.repoName}\n- file: ${gitNL.repoName}/README.md\n- commit: ${commitMsg}`;
          mcpBlocks.push({ tag: 'plan.git_bootstrap', summary: head, raw: safeJsonString({ ...gitNL, commitMsg }) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: 'Git bootstrap failed', details: msg }, { status: 502 });
        }
      } else {
        const rootReadme = detectRootReadme(userText);
        if (rootReadme) {
          try {
            const { blocks, commitMsg } = await runRootReadmeFlow(rootReadme);
            mcpBlocks.push(...blocks);
            const head = `Root README flow:\n- file: README.md\n- commit: ${commitMsg}`;
            mcpBlocks.push({ tag: 'plan.root_readme', summary: head, raw: safeJsonString({ ...rootReadme, commitMsg }) });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return NextResponse.json({ error: 'Root README flow failed', details: msg }, { status: 502 });
          }
        } else if (detectFsRootsQuestion(userText)) {
          const roots = filesystemAllowedRoots();
          const summary = [
            'Filesystem allowed directories (based on MCP_filesystem_ARGS):',
            ...roots.resolved.map(r => `- ${r.arg} → ${r.abs}`),
          ].join('\n');
          mcpBlocks.push({ tag: 'filesystem.roots', summary, raw: safeJsonString(roots) });
        }
      }
    }
  }

  if (mcpBlocks.length > 0 && BYPASS_ON_MCP) {
    return localNdjsonFromBlocks(mcpBlocks);
  }

  const augmentedUserContent = embedMcpBlocks(userText, mcpBlocks);
  const outMessages = buildOutgoingMessages(messagesIn, augmentedUserContent, mcpBlocks.length > 0);
  const payload = {
    model: (typeof body?.model === 'string' && body.model) ? body.model : MODEL,
    temperature: Number.isFinite(Number(body?.temperature)) ? Number(body.temperature) : TEMPERATURE,
    max_tokens: Number.isFinite(Number(body?.max_tokens)) ? Number(body.max_tokens) : MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: outMessages,
    stream: STREAMING,
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: anthropicHeaders(),
      body: JSON.stringify(payload),
    });

    // === Non-stream ===
    if (!STREAMING) {
      if (!res.ok) {
        if (mcpBlocks.length > 0 && FALLBACK_ON_ERR) {
          return localNdjsonFromBlocks(mcpBlocks, `Upstream unavailable (${res.status}). Returning local MCP summary.\n\n`);
        }
        const errTxt = await safeText(res);
        return NextResponse.json({ error: `Anthropic error: ${res.status}`, details: safeJson(errTxt) ?? errTxt }, { status: 502 });
      }
      const json = await res.json();
      return NextResponse.json(json);
    }

    // === Streaming NDJSON ===
    if (!res.ok || !res.body) {
      if (mcpBlocks.length > 0 && FALLBACK_ON_ERR) {
        return localNdjsonFromBlocks(mcpBlocks, `Upstream unavailable (${res.status}). Returning local MCP summary.\n\n`);
      }
      const errTxt = await safeText(res);
      return NextResponse.json({ error: `Anthropic error: ${res.status}`, details: safeJson(errTxt) ?? errTxt }, { status: 502 });
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
                } catch {}
              }
            }
          } catch (err) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'error', error: String(err?.message || err) }) + '\n'));
          } finally {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'done' }) + '\n'));
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (err) {
    if (mcpBlocks.length > 0 && FALLBACK_ON_ERR) {
      return localNdjsonFromBlocks(mcpBlocks, `Upstream request failed. Returning local MCP summary.\n\n`);
    }
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
async function safeText(res) { try { return await res.text(); } catch { return ''; } }
function safeJson(txt) { try { return JSON.parse(txt); } catch { return null; } }
function safeJsonString(obj) { try { return JSON.stringify(obj, null, 2); } catch { return '{}'; } }

// ---------------------- Prompt building ----------------------

function buildOutgoingMessages(original, augmentedUserText, hadMcpBlocks) {
  if (!hadMcpBlocks) return original;
  const out = [...original];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') { out[i] = { role: 'user', content: augmentedUserText }; break; }
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
      `MCP_${b.tag} (summary):`, '```text', b.summary, '```', '',
      `MCP_${b.tag}_JSON (verbatim):`, '```json', rawJson, '```', ''
    );
  }
  parts.push('Please analyze the MCP results above: explain findings, risks, and propose clear, actionable fixes (bulleted). Keep it concise and friendly.');
  return parts.join('\n');
}

// ---------------------- Summaries & local stream ----------------------

function summarizeAudit(server, tool, report, url) {
  const pct = formatScore(report?.overallScore);
  const head = `Audit for ${url} [${server}.${tool}]\nOverall: ${report?.overallPass ? 'PASS' : 'FAIL'} (score ${pct})`;
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const lines = pages.map((p) => {
    const sim = p?.similarity != null ? `${p.similarity}` : '—';
    const miss = (p?.sectionsMissing || []).length;
    const at = p?.foundAt ? ` → ${p.foundAt}` : p?.error ? ` → ${p.error}` : '';
    const missingList = miss > 0 ? `; missing: ${p.sectionsMissing.slice(0, 6).join(', ')}${miss > 6 ? '…' : ''}` : '';
    return `- ${cap(p?.type || 'page')}: ${p?.pass ? 'PASS' : 'FAIL'} (sim ${sim}, miss ${miss})${at}${missingList}`;
  });
  return { summary: [head, ...lines].join('\n'), raw: safeJsonString(report) };
}
function summarizeGeneric(server, tool, result) {
  const json = safeJsonString(result);
  let keys = [];
  try { keys = Object.keys(result || {}); } catch {}
  const head = `Result from ${server}.${tool}: ${keys.length ? 'keys=' + keys.join(', ') : 'no keys'}.`;
  return { summary: head, raw: json };
}
function formatScore(s) {
  if (typeof s === 'number') { const pct = s > 1 ? s : s * 100; return `${Math.round(pct)}%`; }
  return '—';
}
function cap(x) { const s = String(x || ''); return s.charAt(0, 0).toUpperCase() + s.slice(1); }
// (fix menor: cap usaba charAt(0).toUpperCase())
function tagBlock(server, tool, { summary, raw }) { return { tag: `${server}.${tool}`, summary, raw }; }

function localNdjsonFromBlocks(blocks, prefix = '') {
  const text = prefix + blocks.map(b => b.summary).join('\n\n');
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(JSON.stringify({ type: 'delta', text }) + '\n'));
      controller.enqueue(enc.encode(JSON.stringify({ type: 'done' }) + '\n'));
      controller.close();
    }
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}