#!/usr/bin/env node
/* MCP Auditor — CLI (stdio)
 * Arranca el servidor MCP y lo conecta a STDIN/STDOUT.
 * No hace trabajo de auditoría aquí; delega a src/server/.
 */

import { createServer } from '../src/server/createServer.js';
import { attachToStdio } from '../src/server/stdioTransport.js';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

function log(level, ...args) {
  const levels = ['error', 'warn', 'info', 'debug'];
  if (levels.indexOf(level) <= levels.indexOf(LOG_LEVEL)) {
    // Siempre a STDERR para no contaminar el canal MCP (STDOUT)
    console.error(`[${level}]`, ...args);
  }
}

process.on('unhandledRejection', (err) => {
  log('error', 'unhandledRejection:', err?.stack || err);
});

process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException:', err?.stack || err);
  // No salimos de inmediato para permitir teardown ordenado.
});

async function main() {
  try {
    log('info', 'Starting mcp-auditor (stdio)…');
    const server = await createServer({
      log: (level, ...args) => log(level, ...args),
    });

    const detach = attachToStdio(server, {
      onClose: () => {
        log('info', 'STDIO closed, shutting down.');
        process.exit(0);
      },
    });

    const shutdown = () => {
      try {
        detach?.();
      } catch (_) {
        /* noop */
      } finally {
        log('info', 'Stopped mcp-auditor.');
        process.exit(0);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    log('error', 'Failed to start mcp-auditor:', err?.stack || err);
    process.exit(1);
  }
}

main();