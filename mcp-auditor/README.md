# mcp-auditor (localmcp)

**mcp-auditor** is a **Model Context Protocol (MCP) server over stdio** that exposes a single tool, `audit_site`, to audit a website’s **Privacy Policy**, **Terms of Service**, and **FAQ** pages.

- Transport: **JSON-RPC 2.0** over **STDIN/STDOUT** (auto-detects **NDJSON** or **LSP-style** framing)
- No external LLM or SDK required to run the server itself
- Designed to be embedded by any chatbot or tool router that speaks MCP stdio

> Behavior mirrors a compliance checker: discover likely policy URLs via common tails (e.g., `/privacy`, `/terms`, `/faq`) and home-page links; fetch → extract text → TF-IDF + cosine similarity vs. bundled PDF templates; enforce required sections; optional spellcheck.

---

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
- [Run (stdio)](#run-stdio)
- [Use from the terminal](#use-from-the-terminal)
  - [List tools](#list-tools)
  - [Call `audit_site`](#call-audit_site)
  - [Expected responses](#expected-responses)
- [Use from Node (minimal client)](#use-from-node-minimal-client)
- [Configuration (env vars)](#configuration-env-vars)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Requirements

- **Node.js ≥ 18.17** (uses `globalThis.fetch` and `AbortController`)
- Read access to the PDF templates in `assets/templates/` (bundled)
- (Optional) Hunspell dictionary files in `assets/dictionaries/` for spellcheck

---

## Install

Clone and install dependencies:

```bash
git clone https://github.com/sofigo1010/localmcp.git
cd mcp-auditor
npm i
```

---

## Run (stdio)

Run the MCP server (stdio):

```bash
npm start
```

This starts a process that reads **JSON‑RPC 2.0** requests from **STDIN** and writes responses to **STDOUT**.  
You won’t see output until a client sends a valid MCP request.

> Framing: if the client writes **LSP** (Content‑Length headers), the server replies in LSP; otherwise it uses **NDJSON** (one JSON per line).

---

## Use from the terminal

You can send requests by piping JSON lines to the server. These examples run the server and send one or more requests in a single shot.

### List tools

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ./bin/mcp-auditor.js
```

### Call `audit_site`

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"audit_site","arguments":{"url":"https://mijenta-tequila.com/"}}}' | node ./bin/mcp-auditor.js
```

> Tip: You can also place multiple lines (one per JSON object) into a HEREDOC and pipe that to `node ./bin/mcp-auditor.js`.

### Expected responses

**tools/list** — successful response (NDJSON line):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "audit_site",
        "description": "Audit Privacy/Terms/FAQ pages against bundled templates",
        "input_schema": {
          "type": "object",
          "properties": { "url": { "type": "string" } },
          "required": ["url"]
        }
      }
    ]
  }
}
```

**tools/call { name: "audit_site", arguments: { url } }** — successful response (truncated):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "overallPass": true,
    "overallScore": 0.87,
    "pages": [
      {
        "type": "privacy",
        "foundAt": "https://example.com/privacy",
        "pass": true,
        "similarity": 91,
        "sectionsFound": ["personal information", "cookies"],
        "sectionsMissing": [],
        "typos": [],
        "typoRate": 0.01,
        "headings": ["Privacy Policy", "Data Security"],
        "qaCount": 0,
        "rawTextLength": 25432,
        "notes": []
      }
    ]
  }
}
```

> Exact values (similarity, sections, etc.) will vary by site and templates.

---

## Use from Node (minimal client)

Below is a minimal Node client that launches the server as a child process, sends an MCP request over **stdio**, and prints the result.

```js
// examples/min-client.mjs
import { spawn } from "node:child_process";

function sendNdjson(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + "\n");
}

const child = spawn("node", ["./bin/mcp-auditor.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      console.log("<<", msg);
    } catch {}
  }
});

// List tools, then call audit_site
sendNdjson(child, { jsonrpc: "2.0", id: 1, method: "tools/list" });
sendNdjson(child, {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "audit_site", arguments: { url: "https://example.com" } },
});

// Close after a short delay
setTimeout(() => child.kill(), 5000);
```

Run it:

```bash
node examples/min-client.mjs
```

---

## Configuration (env vars)

All are optional—reasonable defaults exist.

| Variable                                 | Description                                    | Default              |
| ---------------------------------------- | ---------------------------------------------- | -------------------- |
| `BEVSTACK_TIMEOUT_MS`                    | Per-request timeout (ms)                       | `20000`              |
| `BEVSTACK_FETCH_RETRIES`                 | Retry attempts for transient fetch failures    | `2`                  |
| `BEVSTACK_USER_AGENT`                    | Fetch User-Agent                               | Realistic desktop UA |
| `BEVSTACK_MAX_HTML_SIZE_BYTES`           | Max HTML bytes per fetch                       | `2000000`            |
| `BEVSTACK_PASS_THRESHOLD`                | Similarity threshold for Privacy/Terms (0–100) | `80`                 |
| `BEVSTACK_FAQ_SOFT_PASS`                 | FAQ soft threshold (0–100)                     | `60`                 |
| `BEVSTACK_ENABLE_SPELLCHECK`             | Enable spellcheck (`true`/`false`)             | `true`               |
| `BEVSTACK_SPELL_WHITELIST_APPEND`        | Extra allowlist terms (comma-separated)        | `""`                 |
| `BEVSTACK_ALLOW_MISSING_PRIVACY`         | Allowed missing sections for Privacy           | `1`                  |
| `BEVSTACK_ALLOW_MISSING_TERMS`           | Allowed missing sections for Terms             | `2`                  |
| `BEVSTACK_ALLOW_MISSING_FAQ`             | Allowed missing sections for FAQ               | `0`                  |
| `BEVSTACK_AUDITOR_PRIVACY_TAILS_PREPEND` | Extra discovery tails (comma) for Privacy      | `""`                 |
| `BEVSTACK_AUDITOR_PRIVACY_TAILS_APPEND`  | Extra discovery tails (comma) for Privacy      | `""`                 |
| `BEVSTACK_AUDITOR_TERMS_TAILS_PREPEND`   | Extra discovery tails (comma) for Terms        | `""`                 |
| `BEVSTACK_AUDITOR_TERMS_TAILS_APPEND`    | Extra discovery tails (comma) for Terms        | `""`                 |
| `BEVSTACK_AUDITOR_FAQ_TAILS_PREPEND`     | Extra discovery tails (comma) for FAQ          | `""`                 |
| `BEVSTACK_AUDITOR_FAQ_TAILS_APPEND`      | Extra discovery tails (comma) for FAQ          | `""`                 |

---

## How it works

1. **Discovery:** Finds candidate URLs (tails + `<a href>` from home).
2. **Fetch & extract:** Retrieves HTML with resilient settings, converts to text.
3. **Scoring:** Computes TF-IDF + cosine similarity vs. bundled PDFs (`PP.pdf`, `TOS.pdf`, `CS.pdf`).
4. **Section checks:** Enforces required sections per doc type.
5. **Spellcheck:** Optional Hunspell check with project allowlist.
6. **Report:** Aggregates page-level results into an overall pass/fail and score.

---

## Troubleshooting

- **Cheerio ESM import error:** use `import { load } from 'cheerio'` and then `const $ = load(html)`.
- **“fetch home failed”**: may be SSL/bot-protection or site down; the server retries and also probes direct tails.
- **Spellcheck is flagging brand terms:** add them to `assets/dictionaries/allowlist.txt` or use `BEVSTACK_SPELL_WHITELIST_APPEND`.
- **No output** when running `npm start`: expected until a JSON-RPC request is received on STDIN.
- **Framing mismatch:** server uses LSP if the client sends LSP; otherwise NDJSON. Use one framing per session.

---

## License

MIT — see [`LICENSE`](./LICENSE).
