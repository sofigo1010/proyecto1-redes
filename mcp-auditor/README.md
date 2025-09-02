# mcp-auditor

**mcp-auditor** is an **MCP (Model Context Protocol) server over stdio** that exposes the `audit_site` tool to audit a website’s **Privacy Policy**, **Terms of Service**, and **FAQ**.

It discovers likely policy pages, fetches them with robust settings (headers, timeouts, retries), converts HTML → text, computes **TF‑IDF + cosine similarity** against bundled **PDF templates**, validates **required sections**, and runs a **spellcheck**. It’s designed so **any custom chatbot** can talk to it over MCP—**no Claude Desktop required**.

> Behavior mirrors a typical compliance API: discover candidate URLs via *tails* (e.g., `/privacy`, `/terms`, `/faq`) and home‑page `<a href>` links; evaluate per‑type thresholds → pass/fail.

---

## Features

- 🔌 **MCP stdio**: JSON‑RPC 2.0 over STDIN/STDOUT (NDJSON or LSP framing, auto‑detected).
- 🔎 **Smart discovery**: Tries common tails and parses the home page for links. Shopify‑aware tails like `/policies/privacy-policy` and `/policies/terms-of-service` are included.
- 📄 **Template matching**: Scores against `PP.pdf`, `TOS.pdf`, `CS.pdf` (bundled).
- ✅ **Section checks**: Validates required sections per document type.
- 🔤 **Spellcheck**: Hunspell dictionary support with project allowlist.
- 🛡️ **Robust fetch**: Realistic headers, timeouts, retries, and response size caps.
- ⚙️ **Configurable**: Thresholds, tails, timeouts, retries, spellcheck, and more via environment variables.

---

## Requirements

- **Node.js ≥ 18.17** (uses `globalThis.fetch` and `AbortController`)
- Read access to the PDFs in `assets/templates/` (bundled)
- Optional Hunspell dictionary files in `assets/dictionaries/` (see that folder’s README)

---

## Install

### Local (from the repo)

```bash
npm i
```

### Global (if you later publish to npm)

```bash
npm i -g mcp-auditor
```

---

## Run the MCP server (stdio)

```bash
npm start
```

The server speaks **JSON‑RPC 2.0** over **STDIN/STDOUT**. It supports both **NDJSON** and **LSP‑style** framing and mirrors whichever the client uses first.

If your project uses a custom manifest path, ensure `mcp.manifest.json` is present next to the binary or set your own loader accordingly.

---

## Use it from your chatbot / tool router

1. **Spawn** the server (`node ./bin/mcp-auditor.js` or your installed binary) with stdio pipes open.
2. Send JSON‑RPC messages:
   - `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
   - `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"audit_site","arguments":{"url":"https://..."}}}`
3. Read `result` and present the report to your user.

### Minimal NDJSON client (shell)

```bash
# List tools
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
| node ./bin/mcp-auditor.js

# Call audit_site
printf '%s\n' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"audit_site","arguments":{"url":"https://example.com"}}}' \
| node ./bin/mcp-auditor.js
```

If you prefer a Node client, see `examples/node-client/`.

---

## Tools

### `audit_site` (primary)

**Input**

```json
{ "url": "https://your-site.com" }
```

**Output**

```json
{
  "overallPass": true,
  "overallScore": 0.87,
  "pages": [
    {
      "type": "privacy|terms|faq",
      "foundAt": "https://...",
      "pass": true,
      "similarity": 91,
      "sectionsFound": ["personal information", "cookies", "..."],
      "sectionsMissing": [],
      "typos": [],
      "typoRate": 0.01,
      "headings": ["Privacy Policy", "Data Security", "..."],
      "qaCount": 0,
      "rawTextLength": 25432,
      "notes": []
    }
  ]
}
```

**Pass/Fail**

- Overall pass requires **Privacy** and **Terms** to pass.
- **FAQ** is *soft*; failing FAQ does not block the overall pass.
- Missing sections tolerance is configurable per type (see env).

**Discovery**

- Built‑in tails include Shopify‑specific routes (e.g., `/policies/privacy-policy`). You can prepend/append tails via env variables.

---

### `get_required_sections` (optional)

- **Input**: `{ "type": "privacy"|"terms"|"faq" }`  
- **Output**: `{ "sections": ["..."] }`

### `get_templates_info` (optional)

- **Output**: `{ "templates": [{ "name": "PP.pdf", "path": "...", "size": 12345 }, ...] }`

### `dry_run` (optional, debug)

- **Input**: `{ "url": "https://..." }`  
- **Output**: `{ "candidates": ["..."], "headings": ["..."] }`

---

## Environment variables

> All are optional—reasonable defaults are provided.

| Variable                                | Description                                   | Default |
| --------------------------------------- | --------------------------------------------- | ------- |
| `BEVSTACK_TIMEOUT_MS`                   | Per‑request timeout (ms)                      | `20000` |
| `BEVSTACK_FETCH_RETRIES`                | Retry attempts for transient fetch failures   | `2`     |
| `BEVSTACK_USER_AGENT`                   | Fetch User‑Agent                              | Realistic desktop UA |
| `BEVSTACK_MAX_HTML_SIZE_BYTES`          | Max HTML bytes per fetch                      | `2000000` |
| `BEVSTACK_PASS_THRESHOLD`               | Similarity threshold for Privacy/Terms (0–100)| `80`    |
| `BEVSTACK_FAQ_SOFT_PASS`                | FAQ soft threshold (0–100)                    | `60`    |
| `BEVSTACK_ENABLE_SPELLCHECK`            | Enable spellcheck (`true`/`false`)            | `true`  |
| `BEVSTACK_SPELL_WHITELIST_APPEND`       | Extra allowlist terms (comma‑separated)       | `""`    |
| `BEVSTACK_ALLOW_MISSING_PRIVACY`        | Allowed missing sections for Privacy          | `1`     |
| `BEVSTACK_ALLOW_MISSING_TERMS`          | Allowed missing sections for Terms            | `2`     |
| `BEVSTACK_ALLOW_MISSING_FAQ`            | Allowed missing sections for FAQ              | `0`     |
| `BEVSTACK_AUDITOR_PRIVACY_TAILS_PREPEND`| Extra discovery tails (comma) for Privacy     | `""`    |
| `BEVSTACK_AUDITOR_PRIVACY_TAILS_APPEND` | Extra discovery tails (comma) for Privacy     | `""`    |
| `BEVSTACK_AUDITOR_TERMS_TAILS_PREPEND`  | Extra discovery tails (comma) for Terms       | `""`    |
| `BEVSTACK_AUDITOR_TERMS_TAILS_APPEND`   | Extra discovery tails (comma) for Terms       | `""`    |
| `BEVSTACK_AUDITOR_FAQ_TAILS_PREPEND`    | Extra discovery tails (comma) for FAQ         | `""`    |
| `BEVSTACK_AUDITOR_FAQ_TAILS_APPEND`     | Extra discovery tails (comma) for FAQ         | `""`    |

---

## Assets

The PDF templates live under `assets/templates/`:

- `PP.pdf` (Privacy)
- `TOS.pdf` (Terms)
- `CS.pdf` (FAQ / Customer Support)

Replace these PDFs if you need different markets/languages—the matcher adapts to the new text.

The optional dictionary files live under `assets/dictionaries/`:

- `en_US.aff` / `en_US.dic` (Hunspell). If missing, spellcheck disables itself gracefully.
- `allowlist.txt` (one term per line) to ignore brand/industry words in typo reports.

---

## Troubleshooting

- **Cheerio ESM import error**: use `import { load } from 'cheerio'` and `const $ = load(html)`.
- **“fetch home failed”**: domain/SSL issue or bot‑protection; the server retries and also tries direct tails.
- **Spellcheck flags brand names**: add them to `assets/dictionaries/allowlist.txt` or pass `BEVSTACK_SPELL_WHITELIST_APPEND`.
- **PDF parsing**: the server uses `pdfjs-dist` (PDF.js). Ensure the bundled PDFs exist and are readable.
- **Framing**: if the client sends `Content‑Length` headers (LSP framing), the server responds in LSP; otherwise it uses NDJSON.

---

## License

MIT — see `LICENSE`.
