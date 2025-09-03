# proyecto1-redes — Chat (Next.js) + MCP stdio (auditor, filesystem, git)

This repository provides a chat UI (Next.js) that talks to **Anthropic Claude** and can invoke local **MCP stdio** servers. It is **multi‑MCP** and streams responses while embedding MCP results (summary + raw JSON) into the prompt.

## What’s included

- **chat/** – Next.js app (Claude + multi‑MCP orchestrator over stdio)
- **mcp-auditor/** – MCP server (Node) exposing `audit_site` (checks Privacy/Terms/FAQ pages against PDF templates)
- **mcp-filesystem/** – MCP server (Node) for **filesystem** operations (create folders/files, read, etc.)
- **mcp-git/** – MCP server (Python) for **git** operations (stage/commit and more)

> MCP servers are auto‑started by the chat service using `chat/src/config/mcp.servers.js`. You can override command/args/CWD via environment variables if your local paths differ.

---

## Quick start (from a fresh clone)

### Prerequisites

- **Node.js ≥ 18.17**
- **Git**
- **Python 3.10+** (for the git MCP)
- An **Anthropic API key**

### 1) Install each MCP server and the chat

From the repository root:

```bash
# mcp-auditor (Node)
cd mcp-auditor
npm i

# mcp-filesystem (Node)
cd ../mcp-filesystem
npm i

# mcp-git (Python)
cd ../mcp-git
python -m venv .venv
source .venv/bin/activate     # macOS/Linux
# .venv\Scripts\activate    # Windows (PowerShell)
pip install .
```

Then install the chat app and set up environment variables:

```bash
cd ../chat
npm i
```

Create **`chat/.env.local`** (minimal example):

```env
# Anthropic / Claude
ANTHROPIC_API_KEY=sk-ant-...

AI_MODEL=claude-3-5-haiku-20241022
AI_TEMPERATURE=0.7
AI_MAX_OUTPUT_TOKENS=1024
AI_STREAMING=true

# MCP logging, timeouts
MCP_LOG_LEVEL=info
MCP_REQUEST_TIMEOUT_MS=30000
MCP_IDLE_TTL_MS=120000

# Optional overrides if your paths differ:
# MCP_auditor_CMD=node ../mcp-auditor/bin/mcp-auditor.js
# MCP_auditor_CWD=../mcp-auditor
# MCP_filesystem_ARGS=..
# MCP_git_ARGS=--repository ..
```

### 2) Run the chat (dev)

```bash
npm run dev
# open http://localhost:3000
```

The chat will start/stop MCP processes automatically as needed.

---

## Source of filesystem & git MCP servers

The **filesystem** and **git** MCP servers used in this project were sourced from the official
**Model Context Protocol** servers repository (Anthropic):

https://github.com/modelcontextprotocol/servers/tree/main/src

They are kept locally in `mcp-filesystem/` and `mcp-git/` so you can develop and run everything
in one workspace without global installs. You can re‑sync from the upstream repo whenever you
want to pick up improvements.

---

## Filesystem & Git: minimal examples to test

Below are the **exact examples** that were verified in this project. Paste them into the chat input exactly as written:

```text
/mcp filesystem create_directory {"path":"/Users/sofig/Documents/GitHub/proyecto1-redes/loba"}

/mcp filesystem write_file {"path":"/Users/sofig/Documents/GitHub/proyecto1-redes/loba/morchis.txt","content":"este es mi comich desde el mcp"}

/mcp git git_add { "repo_path":"/Users/sofig/Documents/GitHub/proyecto1-redes", "files":["loba/morchis.txt"] }

/mcp git git_commit { "repo_path":"/Users/sofig/Documents/GitHub/proyecto1-redes", "message":"feat: add morchis.txt en loba" }
```

> Notes
>
> - The filesystem MCP is configured to allow the repository root as a safe base. Absolute paths inside that root work as shown.
> - The git MCP in this setup is anchored to the **repository root** via `--repository ..`, so `repo_path` in examples points to the root folder.

---

## Important limitation: **LLMs cannot push to a repository**

For security and credential reasons, the chat/LLM **cannot perform `git push`** (or any credentialed network operation) on your behalf. Pushing requires your local credentials/agent and should be done manually in your terminal from the repository root, for example:

```bash
git push -u origin main
```

If a remote isn’t set yet, add it once and then push:

```bash
git remote add origin git@github.com:<user>/<repo>.git   # or HTTPS URL
git push -u origin main
```

---

## Auditor MCP (overview)

You can ask the chat to audit a site’s Privacy/Terms/FAQ pages against built‑in templates (TF‑IDF cosine, section checks, optional spellcheck). Example prompts:

- “Audit https://example.com and compare with the Bevstack templates.”
- `/audit https://example.com`

The chat embeds the auditor’s structured results into the prompt and asks Claude for a concise, user‑friendly report.

---

## Troubleshooting

- **Initialization race warnings** in logs (e.g., “Received request before initialization was complete”) can appear when an MCP is still starting up; simply retry your command.
- **Filesystem ‘parent directory does not exist’** → create the folder first via `create_directory`.
- **Environment differences** → override `MCP_*` variables in `chat/.env.local` to match your paths.

---

## License

**Proprietary / All rights reserved.** No license is granted to copy, distribute, or modify this code without explicit permission from the author.
