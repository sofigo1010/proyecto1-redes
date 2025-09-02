# proyecto1-redes — Chat (Next.js) + mcp-auditor (MCP stdio)

This repo contains two sibling projects that work together:

- **chat/** – a Next.js chat UI that talks to **Anthropic Claude** and can call local **MCP stdio servers** (multi‑MCP ready). It streams responses and embeds MCP results (summary + raw JSON) into the prompt.
- **mcp-auditor/** – an MCP server (over stdio) exposing `audit_site`, which audits a website’s **Privacy Policy**, **Terms of Service**, and **FAQ** against PDF templates (TF‑IDF cosine, section checks, spellcheck).

> The chat orchestrator can call the auditor automatically (natural‑language intent) or via slash commands, then ask Claude to produce a concise, user‑friendly report.

---

## Repo layout

```
proyecto1-redes/
├─ chat/          # Next.js app (Claude + multi-MCP orchestrator)
└─ mcp-auditor/   # MCP stdio server exposing `audit_site`
```

---

## Objectives

1. Provide a clean, modern chat that can answer general questions using Claude.
2. Seamlessly invoke local MCP tools when useful (e.g., Bevstack site audits).
3. Stream results and persist multi‑session chat history on the client.
4. Be **multi‑MCP** from day one (easy to add more servers).

---

## Quick start (install **both** chat and auditor)

### Prerequisites
- Node.js **≥ 18.17**
- An **Anthropic API key**

### 1) Install **mcp-auditor**
This project expects the auditor to live as a sibling folder at `../mcp-auditor` relative to `chat/`.

```bash
# from repo root
cd mcp-auditor
npm i
```

Notes:
- The server bundles PDF templates under `mcp-auditor/assets/templates/` (`PP.pdf`, `TOS.pdf`, `CS.pdf`). You can replace them; the matcher adapts automatically.
- Optional Hunspell dictionaries live in `mcp-auditor/assets/dictionaries/`. If missing, spellcheck disables itself gracefully.

You can manually smoke‑test the server:
```bash
# Still inside mcp-auditor/
printf '%s
' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ./bin/mcp-auditor.js

printf '%s
' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"audit_site","arguments":{"url":"https://mijenta-tequila.com"}}}' | node ./bin/mcp-auditor.js
```

### 2) Install **chat**
```bash
# from repo root
cd chat
npm i
```

Create `chat/.env.local` with at least your key:

```env
# ===============================
# Anthropic / Claude (server-side)
# ===============================
# REQUIRED: put your real key here (do NOT commit this file)
ANTHROPIC_API_KEY=sk-ant-...

# Model defaults (overridable per request)
AI_MODEL=claude-3-5-haiku-20241022
AI_TEMPERATURE=0.7
AI_MAX_OUTPUT_TOKENS=1024
AI_STREAMING=true

# ===============================
# MCP (mcp-auditor) integration
# ===============================
# Logging and timeouts
MCP_LOG_LEVEL=info
MCP_REQUEST_TIMEOUT_MS=30000
MCP_IDLE_TTL_MS=120000

# By default the chat auto-detects the sibling server at ../mcp-auditor.
# If your paths differ, uncomment and adjust:
# MCP_auditor_CMD=node ../mcp-auditor/bin/mcp-auditor.js
# MCP_auditor_CWD=../mcp-auditor
# MCP_auditor_ARGS=
# MCP_auditor_MANIFEST=../mcp-auditor/mcp.manifest.json
```

### 3) (Optional) Smoke test MCP from **chat/**
```bash
npm run smoke:mcp
```
This spins up the local **mcp-auditor** and runs a sample `audit_site` call.

### 4) Run the chat (dev)
```bash
npm run dev
# open http://localhost:3000
```

Type normally to chat with Claude. Example MCP usage:
- Natural language: “Audit https://mijenta-tequila.com and compare with Bevstack templates.”
- Slash command: `/audit https://mijenta-tequila.com`
- Generic MCP call: `/mcp auditor get_templates_info`

---

## Run **mcp-auditor** standalone (manual testing)

If you want to run the auditor by itself and send JSON‑RPC messages manually:

```bash
cd mcp-auditor
npm i
```

Start it by piping JSON‑RPC over **STDIN** (NDJSON framing). Examples:

### List tools
```bash
printf '%s
' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ./bin/mcp-auditor.js
```

### Call `audit_site`
```bash
printf '%s
' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"audit_site","arguments":{"url":"https://mijenta-tequila.com"}}}' | node ./bin/mcp-auditor.js
```

### Get template info
```bash
printf '%s
' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_templates_info","arguments":{}}}' | node ./bin/mcp-auditor.js
```

> Notes
> - The server reads one JSON‑RPC message per line and prints one JSON line per response.
> - It supports both NDJSON and LSP‑style framing (auto‑detects from the first message).
> - PDF templates are bundled under `mcp-auditor/assets/templates/`.

---

## Adding another MCP

1. Install/clone the MCP server locally.
2. Register it in `chat/src/config/mcp.servers.js` (command, cwd, env).
3. Call it with `/mcp <server> <tool> <json?>` or add intent rules in `chat/src/app/api/chat/route.js`.

The registry handles stdio lifecycles, JSON‑RPC over NDJSON, per‑request timeouts, and idle auto‑shutdown.

---

## Troubleshooting

- **“ANTHROPIC_API_KEY is not set”** → add it to `chat/.env.local`.
- **MCP path issues** → set `MCP_auditor_CMD`/`CWD` explicitly.
- **No streaming** → the API falls back to a single JSON response; the UI still renders it.
- **Auditor env** → thresholds/timeouts/spellcheck are configured inside `mcp-auditor/`.

---

## License

**Proprietary / All rights reserved.**  
No license is granted to copy, distribute, or modify this code without explicit permission from the author.
