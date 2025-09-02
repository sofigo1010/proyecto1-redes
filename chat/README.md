# chat — Next.js + Claude + multi‑MCP orchestrator

A modern chat UI built with **Next.js** that talks to **Anthropic Claude** and can call local **MCP stdio servers**. It detects natural‑language intent (e.g., “audit this site…”) or offers slash commands and embeds MCP results (summary + raw JSON) in the LLM prompt.

---

## Features

- Streaming replies from Claude (Anthropic Messages API).
- Multi‑session chat history persisted in `localStorage`.
- **Multi‑MCP ready**: stdio JSON‑RPC client/registry with per‑request timeouts and idle auto‑shutdown.
- Bevstack “auditor” integration out of the box (`audit_site`).
- Slash commands:
  - `/audit <url>` – runs the auditor tool
  - `/mcp <server> <tool> <json?>` – call any registered MCP tool directly

---

## Prerequisites

- Node.js **≥ 18.17**
- An **Anthropic API key**

---

## Setup

1) Install dependencies
```bash
npm i
```

2) Create `chat/.env.local` with the following content and edit values as needed:
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

# Optional: if autodetection doesn't find the local server, uncomment:
# MCP_auditor_CMD=node ../mcp-auditor/bin/mcp-auditor.js
# MCP_auditor_CWD=../mcp-auditor
# MCP_auditor_ARGS=
# MCP_auditor_MANIFEST=../mcp-auditor/mcp.manifest.json
```

> By default, the app will try to spawn `../mcp-auditor/bin/mcp-auditor.js`. Use the overrides if your paths differ.

3) (Optional) Smoke test the MCP from `chat/`
```bash
npm run smoke:mcp
```

4) Run the dev server
```bash
npm run dev
# open http://localhost:3000
```

---

## How it works (high level)

- The UI posts to `/api/chat` with either a single `content` string or a `messages[]` array.
- The server route:
  - Detects slash commands and MCP intent.
  - Calls the appropriate MCP server via the stdio registry when needed.
  - Embeds MCP summaries + raw JSON into the user prompt.
  - Streams Anthropic deltas back as NDJSON to the browser.
- The client hook (`src/hooks/useChat.js`) consumes the stream and updates the UI in real time.
- `useChatSessions` stores multiple chat sessions in `localStorage` (rename/delete/new).

---

## Adding another MCP

- Register it in `src/config/mcp.servers.js` with its `cmdLine`, optional `cwd`, and `env`.
- Use `/mcp <server> <tool> <json?>` to call it directly.
- (Optional) Add intent detection in `src/app/api/chat/route.js` to trigger it from natural language.

---

## License

**Proprietary / All rights reserved.**  
No license is granted to copy, distribute, or modify this code without explicit permission from the author.
