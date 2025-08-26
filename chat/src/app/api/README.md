# Bevstack Website Compliance Auditor — Prototype (Next.js + Node)

Audit any website’s **Privacy Policy**, **Terms of Service**, and **FAQ** pages against your **PDF templates**, and surface:

- Whether the pages exist and where they are
- **Similarity score** to your PDF templates (TF-IDF cosine)
- **Required sections** present/missing
- **Spellcheck** (en-US) with a small whitelist
- Page **headings** (H1/H2/H3) for structure

> ✅ Phase 1: simple **UI at `/prueba`** + **API at `/api/prueba`**.

---

## Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Install](#install)
- [Run](#run)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Contract](#api-contract)
- [Troubleshooting](#troubleshooting)
- [Dev Notes](#dev-notes)
- [Roadmap](#roadmap)
- [Quick Start](#quick-start-copypaste)

---

## Features

- **Website discovery**: finds Privacy/Terms/FAQ via homepage links and common fallbacks (`/privacy`, `/terms`, `/faq`, etc.).
- **Template matching**: extracts text from your **PDF templates** and compares via **TF-IDF cosine**.
- **Section check**: validates required clauses (cookies, refunds, governing law, returns, etc.).
- **Spellcheck**: reports top typos and error rate; tolerant (won’t crash if dictionary load fails).
- **Headings**: returns H1/H2/H3 detected on each page.
- **UI + API**: human-friendly UI at `/prueba`, JSON via `/api/prueba`.

---

## Project Structure

```
chat/
├─ src/
│  ├─ app/
│  │  ├─ prueba/
│  │  │  └─ page.jsx                  # Frontend UI (/prueba)
│  │  └─ api/
│  │     └─ prueba/
│  │        └─ route.js               # POST /api/prueba (Node runtime)
│  │
│  │  └─ api/templates/               # PDF templates (YOUR files)
│  │     ├─ PP.pdf                    # Privacy Policy template
│  │     ├─ TOS.pdf                   # Terms of Service template
│  │     └─ CS.pdf                    # Customer/FAQ template
│  │
│  └─ lib/
│     ├─ templateMatcher.js           # PDF → text + TF-IDF + cosine + robust path handling
│     ├─ sections.js                  # extractHeadings + htmlToPlain (HTML → text)
│     └─ spellcheck.js                # nspell + dictionary-en wrapper
└─ package.json
```

---

## Requirements

- **Node.js 18+** (App Router + ESM compatible)
- **npm** or **yarn**
- Network access (to fetch target websites)

---

## Install

From the repo root:

```bash
cd proyecto1-redes/chat

# Install app deps
npm install

# Ensure these libs are present (if not already installed):
npm install pdf-parse nspell dictionary-en
```

---

## Run

```bash
# Start Next dev server
npm run dev

# Open the UI:
# http://localhost:3000/prueba
```

---

## Configuration

1. **PDF templates**  
   Place your 3 templates here (already referenced by the code):

```
chat/src/app/api/templates/PP.pdf   # Privacy Policy
chat/src/app/api/templates/TOS.pdf  # Terms of Service
chat/src/app/api/templates/CS.pdf   # Customer Service / FAQ
```

2. **API uses absolute paths**  
   `src/app/api/prueba/route.js` builds **absolute** paths from `process.cwd()` to avoid URL confusion:

```js
import path from "node:path";

const ROOT = process.cwd();
const TEMPLATE_PATHS = {
  privacy: path.join(ROOT, "src/app/api/templates/PP.pdf"),
  terms: path.join(ROOT, "src/app/api/templates/TOS.pdf"),
  faq: path.join(ROOT, "src/app/api/templates/CS.pdf"),
};
```

3. **Force Node runtime**  
   We explicitly set the route to **Node** (required by `pdf-parse` and `nspell`):

```js
// src/app/api/prueba/route.js
export const runtime = "nodejs";
```

---

## Usage

### UI

Visit:

```
http://localhost:3000/prueba
```

- Enter a homepage URL: `https://brand.com`
- The tool discovers and audits Privacy/Terms/FAQ
- You’ll see similarity %, required sections found/missing, typos, headings, and the page URLs

### API

`POST /api/prueba` with JSON body:

```json
{ "url": "https://brand.com" }
```

---

## API Contract

### Request

```
POST /api/prueba
Content-Type: application/json

{
  "url": "https://brand.com"
}
```

### Response (example)

```json
{
  "language": "en",
  "domain": "brand.com",
  "overallPass": false,
  "overallScore": 72,
  "pages": [
    {
      "type": "privacy",
      "foundAt": "https://brand.com/privacy-policy",
      "similarity": 85,
      "sectionsFound": ["cookies", "data security", "contact"],
      "sectionsMissing": ["your rights"],
      "typos": [
        { "word": "conscent", "suggestions": ["consent"] },
        { "word": "privary", "suggestions": ["privacy"] }
      ],
      "typoRate": 0.9,
      "pass": true,
      "headings": {
        "h1": ["Privacy Policy"],
        "h2": ["Information We Collect"],
        "h3": []
      }
    },
    {
      "type": "terms",
      "foundAt": "https://brand.com/terms",
      "similarity": 78,
      "sectionsFound": ["governing law", "jurisdiction"],
      "sectionsMissing": ["returns", "refunds", "shipping"],
      "typos": [],
      "typoRate": 0.4,
      "pass": false,
      "headings": { "h1": ["Terms of Service"], "h2": [], "h3": [] }
    },
    {
      "type": "faq",
      "foundAt": "https://brand.com/faq",
      "similarity": 65,
      "sectionsFound": ["shipping", "delivery", "returns"],
      "sectionsMissing": ["exchange"],
      "typos": [],
      "typoRate": 0.2,
      "pass": true,
      "headings": { "h1": ["FAQ"], "h2": ["Shipping"], "h3": [] },
      "qaCount": 12
    }
  ]
}
```

**Notes**

- **Pass thresholds**: Privacy/Terms ≥ **80%**, FAQ ≥ **60%**.
- A page must **exist** and meet **similarity** + **required sections** to pass.

---

## Troubleshooting

**Common errors & fixes**

| Symptom / Error                                                                                           | Meaning                                                                     | Fix                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Template PDF not found at path: ...`                                                                     | Wrong path or file missing                                                  | Ensure PDFs exist exactly at `src/app/api/templates/{PP,TOS,CS}.pdf`                                     |
| `Template PDF is empty (0 bytes)`                                                                         | Corrupt/empty file                                                          | Replace the file                                                                                         |
| `The "path" argument must be of type string or an instance of Buffer or URL. Received an instance of URL` | Something tried to pass a WHATWG `URL` to `fs`                              | Use **absolute string paths**; ensure `TEMPLATE_PATHS` are built with `path.join(process.cwd(), ...)`    |
| `ENOENT: ... ./test/data/05-versions-space.pdf`                                                           | `pdf-parse` fallback tried a test file because it didn’t get a valid Buffer | Confirm file sizes are logged > 0; fix paths                                                             |
| `spellcheck disabled due to error: ...`                                                                   | `nspell`/`dictionary-en` failed in your environment                         | Endpoint does **not** crash; typos omitted. Reinstall `nspell dictionary-en` or keep spellcheck disabled |
| `403/429` on site fetch                                                                                   | Target site blocks unknown User-Agents                                      | We send a basic UA; sometimes you still get blocked—try a different site                                 |

**Debug logs**  
The server prints **resolved template paths** and **file sizes**:

```
[templates] resolved paths: { privacy: /abs/PP.pdf, terms: /abs/TOS.pdf, faq: /abs/CS.pdf }
[templates] file sizes (bytes): { privacy: 73768, terms: 72288, faq: 206589 }
```

If sizes show `-1`, the path does not exist; if `0`, the file is empty.

---

## Dev Notes

- **Node runtime** is required: `export const runtime = 'nodejs';` in the route file.
- **Absolute paths** for templates (from `process.cwd()`) avoid ESM/URL quirks.
- **Spellcheck**:
  - Implemented with `nspell` + `dictionary-en`.
  - The route dynamically imports spellcheck; **if it fails, it logs and continues** (no 500).
  - A small whitelist avoids false positives on beverage terms (añejo, reposado, mezcal…).
- **Discovery**:
  - Extracts links from homepage HTML.
  - Falls back to `/privacy`, `/terms`, `/faq`, `/help`, etc.
- **Headings & plain text**:
  - `sections.js` extracts H1/H2/H3 and normalizes entire HTML to plain text for scoring.

---

## Roadmap

- Integrate with **Anthropic MCP** as a tool (same API contract).
- Improve discovery (sitemap, structured footer parsing).
- Add rate limiting and respect `robots.txt` for batch runs.
- Optional **CSV/Excel export** of results.
- Richer UI (sorting, filters, charts).
- Extend spellcheck dictionary and per-brand domain whitelists.

---

## Quick Start (Copy/Paste)

```bash
# 1) Go to the app folder
cd proyecto1-redes/chat

# 2) Install
npm install
npm install pdf-parse nspell dictionary-en

# 3) Place your PDFs
# chat/src/app/api/templates/PP.pdf
# chat/src/app/api/templates/TOS.pdf
# chat/src/app/api/templates/CS.pdf

# 4) Run
npm run dev

# 5) Use the UI
# http://localhost:3000/prueba
```
