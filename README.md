# PROYECTO1-REDES — Project Overview (Anthropic-only)

**What is this repository?**  
A single **Next.js** web app that served as the **chat UI (host)** for an AI assistant. The system was implemented **entirely with Anthropic** technologies:

- **LLM:** Anthropic **Claude** handled conversation and reasoning.
- **Tools via MCP:** The app orchestrated tools through the **Model Context Protocol (MCP)**.
- **Official MCP servers (local):** Anthropic’s official **Filesystem** and **Git** MCP servers were integrated from the public examples; the chat UI demonstrated file creation, repository initialization, staging, and committing through tool calls.
- **Custom MCP server (local):** A **non-trivial custom MCP server** was implemented and exposed via MCP with a concise spec and usage examples.
- **Remote MCP server (cloud):** An MCP server was **deployed remotely** and connected from the same chat UI to demonstrate safe, off-machine tool invocation.
  > The **same Next.js frontend** is the single entry point used to demo all stages above.

---

# 1) Frontend — Run locally (GitHub → install → dev)

```bash
# 1) Clone the repository from GitHub
git clone https://github.com/sofigo1010/proyecto1-redes.git
cd proyecto1-redes/chat

# 2) Install dependencies
npm install

# 3) Start the development server
npm run dev
```

Open **http://localhost:3000**.

---

## Requirements

- **Node.js ≥ 18.17** (recommended **20 LTS**)
- **npm ≥ 9**

Check versions:

```bash
node -v
npm -v
```

---

## Useful npm scripts

```bash
npm run dev     # start dev server with hot reload
npm run build   # production build
npm run start   # serve the production build after `npm run build`
```

## Minimal layout

```
proyecto1-redes/
  chat/
    public/
    src/
      app/          # routes (App Router)
      components/   # shared UI
      ui/           # primitives
    next.config.mjs
    package.json
```
