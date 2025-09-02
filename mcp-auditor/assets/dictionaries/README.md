# Dictionaries & Allowlist (optional)

This folder can contain spell resources used by the auditor. If nothing is present, the spellcheck feature disables itself safely.

## Files

- `en_US.aff` / `en_US.dic` — Hunspell dictionary files for English (US).
- `allowlist.txt` — One term per line (case‑insensitive). Terms present here are never flagged as typos. Useful for brand and industry words (e.g., “Mijenta”, “reposado”, “añejo”).

## Adding dictionaries

You have several options:

### 1) Copy system Hunspell files (Homebrew on macOS)

```bash
# example paths; adjust if needed
cp /opt/homebrew/share/hunspell/en_US.aff assets/dictionaries/en_US.aff
cp /opt/homebrew/share/hunspell/en_US.dic assets/dictionaries/en_US.dic
```

### 2) Use an npm package

If you prefer npm‑managed dictionaries, install a package that provides `.aff/.dic` files (e.g., `dictionary-en` or similar) and copy the files into this folder. The export shapes differ across packages, so a robust Node snippet is recommended to write the files at build time.

### 3) Skip dictionaries

If the `.aff/.dic` files are absent, the auditor runs without spellchecking.

## Allowlist

Create `allowlist.txt` and add one term per line. The spellchecker will ignore exact case‑insensitive matches for these terms (after basic normalization). You can also append a comma‑separated list via the `BEVSTACK_SPELL_WHITELIST_APPEND` environment variable.
