# Example MCP client (Node)

This is a **minimal NDJSON client** that spawns the local `mcp-auditor` server and calls the `audit_site` tool.

## Prerequisites

- Node.js ≥ 18.17
- This repository cloned locally (or `mcp-auditor` installed globally)

## Run

```bash
npm start -- https://example.com
```

If you omit the URL, it defaults to `https://example.com`.

## How it works

- Spawns the server using either:
  - the local bin (`node ../../bin/mcp-auditor.js`), or
  - a global command via `MCP_SERVER_CMD` env var (e.g., `export MCP_SERVER_CMD=mcp-auditor`).
- Speaks **JSON‑RPC 2.0** over **STDIN/STDOUT** using **NDJSON** framing.
- Sends:
  - `tools/list` to discover tools
  - `tools/call` with `{ name: "audit_site", arguments: { url } }`
- Prints the JSON result to STDOUT.

## Troubleshooting

- If the child process cannot spawn, verify Node and file permissions.
- If you see a “RPC timeout”, increase the client timeout or check the server logs (stderr).
