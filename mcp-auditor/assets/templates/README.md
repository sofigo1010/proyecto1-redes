# PDF Templates

This folder contains the PDF templates used to score content via TF‑IDF + cosine similarity.

## Default templates

- `PP.pdf` — Privacy Policy template
- `TOS.pdf` — Terms of Service template
- `CS.pdf` — FAQ / Customer Support template

> These are bundled by default. Replace them to adapt audits to other markets or languages—the matcher recalculates similarity automatically.

## Notes

- Files are loaded at runtime and cached by `(mtime, size)`.
- Use the `get_templates_info` tool to verify availability and sizes.
- If a template is missing or corrupt, the server will throw when attempting to read it.

## Dictionary & Allowlist (optional)

You can optionally add spell resources under `assets/dictionaries/`:

- `en_US.aff` / `en_US.dic` — Hunspell dictionary files.
- `allowlist.txt` — one term per line; terms here are never flagged as typos (useful for brand/industry words).

If dictionaries are missing, spellcheck disables itself safely.
