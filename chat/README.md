# chat — Next.js + Claude + multi‑MCP orchestrator

A modern chat UI built with **Next.js** that talks to **Anthropic Claude** and can call local **MCP stdio servers**.  
It detects natural‑language intent (e.g., “audit this site…”) or accepts slash commands, and it embeds MCP results (summary + raw JSON) into the LLM prompt while streaming replies.

---

## Features

- Streaming replies from Claude (Anthropic Messages API)
- Multi‑session chat history persisted in `localStorage`
- **Multi‑MCP ready**: stdio JSON‑RPC client/registry with per‑request timeouts, idle auto‑shutdown, and robust init handshake
- Built‑in MCPs (spawned on demand):
  - **auditor** (`audit_site`): audits Privacy/Terms/FAQ against templates
  - **filesystem**: create/read/write files and directories
  - **git**: stage/commit and other repo operations
- Slash commands:
  - `/audit <url>` – run the auditor tool
  - `/mcp <server> <tool> <json?>` – call any registered MCP tool directly

> The chat auto‑starts MCP servers using `src/config/mcp.servers.js`. You can override each server’s command/args/CWD via env vars.

---

## Prerequisites

- Node.js **≥ 18.17**
- An **Anthropic API key** (server‑side)
- To use **filesystem** and **git** MCPs, make sure sibling directories exist and are installed at the repo root (see the root README for full steps):
  - `../mcp-filesystem` (Node, `npm i`)
  - `../mcp-git` (Python, `python -m venv .venv && pip install .`)

---

## Setup (chat only)

1. Install dependencies

```bash
npm i
```

2. Create `chat/.env.local` with the following content and edit values as needed:

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
# MCP integration (logging, timeouts, overrides)
# ===============================
MCP_LOG_LEVEL=info
MCP_REQUEST_TIMEOUT_MS=30000
MCP_IDLE_TTL_MS=120000

# Optional overrides if autodetection doesn’t match your paths
# Auditor (Node)
# MCP_auditor_CMD=node ../mcp-auditor/bin/mcp-auditor.js
# MCP_auditor_CWD=../mcp-auditor
# MCP_auditor_ARGS=
# MCP_auditor_MANIFEST=../mcp-auditor/mcp.manifest.json

# Filesystem (Node)
# MCP_filesystem_ARGS=..                        # allowed roots (default: ..)
# MCP_filesystem_CWD=../mcp-filesystem

# Git (Python)
# MCP_git_ARGS=--repository ..                  # anchor to repo root (default)
# MCP_git_CWD=../mcp-git
```

3. Run the dev server

```bash
npm run dev
# open http://localhost:3000
```

---

## Using MCP from the chat

### Discover available tools

```text
/mcp filesystem tools.list
/mcp git tools.list
/mcp auditor tools.list
```

### Minimal, verified examples (filesystem + git)

Paste **exactly** these four commands to create a folder, add a file, stage and commit it:

```text
/mcp filesystem create_directory {"path":"/Users/sofig/Documents/GitHub/proyecto1-redes/loba"}

/mcp filesystem write_file {"path":"/Users/sofig/Documents/GitHub/proyecto1-redes/loba/morchis.txt","content":"este es mi comich desde el mcp"}

/mcp git git_add { "repo_path":"/Users/sofig/Documents/GitHub/proyecto1-redes", "files":["loba/morchis.txt"] }

/mcp git git_commit { "repo_path":"/Users/sofig/Documents/GitHub/proyecto1-redes", "message":"feat: add morchis.txt en loba" }
```

**Important limitation: LLMs cannot push.**  
For security/credentials reasons, the chat/LLM **cannot perform `git push`**. Push from your terminal instead:

```bash
git push -u origin main
```

If a remote isn’t set yet:

```bash
git remote add origin git@github.com:<user>/<repo>.git   # or HTTPS
git push -u origin main
```

### Auditor example

- Natural language: “Audit https://example.com and compare with the Bevstack templates.”
- Slash: `/audit https://example.com`

The route embeds the auditor’s structured results and asks Claude for a concise, user‑friendly report.

---

## Where the filesystem & git MCP servers come from

The **filesystem** and **git** MCP servers used here are sourced from Anthropic’s official **Model Context Protocol** servers repository:

https://github.com/modelcontextprotocol/servers/tree/main/src

They’re included locally (as `../mcp-filesystem` and `../mcp-git`) so you can develop and run everything in one workspace.

---

## How it works (high level)

- The UI posts to `/api/chat` with a single `content` string or a `messages[]` array.
- The server route:
  - Detects slash commands and intent for known MCP flows.
  - Calls MCP servers via a stdio registry, with a tolerant `initialize` handshake and timeouts.
  - Embeds MCP summaries + raw JSON into the user prompt.
  - Streams Anthropic deltas back as NDJSON to the browser.
- The client hook (`src/hooks/useChat.js`) consumes the stream and updates the UI.
- `useChatSessions` stores multiple chat sessions in `localStorage` (rename/delete/new).

---

## Troubleshooting

- **“Received request before initialization was complete”** — transient while an MCP is booting; retry
- **Filesystem: “parent directory does not exist”** — create it first with `create_directory`
- **Paths differ from your machine** — use the `MCP_*` overrides in `.env.local`
- **Push fails in chat** — expected; push in your terminal (LLM cannot push)

---

## License

**Proprietary / All rights reserved.**  
No license is granted to copy, distribute, or modify this code without explicit permission from the author.
