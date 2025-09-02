// Declarative registry of MCP stdio servers (multi-MCP ready).
// Este módulo centraliza cómo se resuelven los comandos/entornos para
// cada servidor MCP que se quiera correr por stdio.
// La app de chat consulta esta función para saber cómo spawnnear
// (cmdLine, cwd, env) de cada servidor por nombre.
//
// Convenciones de variables de entorno por servidor (ej. "auditor"):
//   - MCP_auditor_CMD       → línea de comando completa (tiene prioridad máxima)
//   - MCP_auditor_ARGS      → argumentos extra que se anexan al comando
//   - MCP_auditor_CWD       → directorio de trabajo del proceso hijo
//   - MCP_auditor_MANIFEST  → ruta explícita a mcp.manifest.json
//   - MCP_LOG_LEVEL         → nivel de logs para el servidor (se inyecta como LOG_LEVEL)
//
// Además, si existe un repo hermano ../mcp-auditor, se detecta y se
// construye un default razonable: `node ../mcp-auditor/bin/mcp-auditor.js`
// con cwd en ese repo y MCP_MANIFEST_PATH apuntando a su manifest.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resuelve rutas candidatas al repo hermano "mcp-auditor".
 * Se usa para ofrecer defaults sin necesidad de configurar envs.
 */
function siblingAuditorPaths() {
  // Este archivo vive en chat/src/config → subir a chat/
  const chatDir = path.resolve(__dirname, '..', '..');
  // Repo hermano a la par de chat/
  const repoDir = path.resolve(chatDir, '../mcp-auditor');
  const binJs = path.join(repoDir, 'bin', 'mcp-auditor.js');
  const manifest = path.join(repoDir, 'mcp.manifest.json');
  return { repoDir, binJs, manifest };
}

/**
 * Construye la línea de comando por defecto para el servidor "auditor".
 * Prioridad:
 *  1) MCP_auditor_CMD (línea completa provista por env)
 *  2) Repo hermano: usar el Node actual + bin local (si existe)
 *  3) Binario global en PATH: "mcp-auditor"
 */
function defaultAuditorCmdLine() {
  const envLine = (process.env.MCP_auditor_CMD || '').trim();
  if (envLine) return envLine;

  const { binJs } = siblingAuditorPaths();
  if (fs.existsSync(binJs)) {
    // Usa el mismo Node del proceso actual para evitar discrepancias de versiones
    return `${process.execPath} ${binJs}`;
  }
  // Fallback: bin global
  return 'mcp-auditor';
}

/**
 * Determina cwd/env por defecto para "auditor" si el repo hermano existe.
 * - cwd: repo raíz de mcp-auditor (para que resuelva assets relativos)
 * - MCP_MANIFEST_PATH: solo si no se definió ya por env
 */
function defaultAuditorCwdAndEnv() {
  const out = { cwd: undefined, env: {} };
  const { repoDir, manifest } = siblingAuditorPaths();

  if (fs.existsSync(repoDir)) {
    out.cwd = repoDir; // correr desde la raíz del repo hermano
  }
  if (!process.env.MCP_auditor_MANIFEST && fs.existsSync(manifest)) {
    out.env.MCP_MANIFEST_PATH = manifest;
  }
  return out;
}

/**
 * Devuelve el mapa de configuración: nombre → { cmdLine, cwd?, env? }.
 * - cmdLine: string con el ejecutable + args (la app hará el split).
 * - cwd: string opcional; si no se define, se hereda el cwd del proceso padre.
 * - env: objeto parcial que se fusiona sobre process.env para ese hijo.
 *
 * Para añadir más MCPs en el futuro, agregar otro bloque al objeto retornado.
 */
export default function getMcpServersConfig() {
  // Construye el comando base y anexa argumentos opcionales
  const baseCmd = defaultAuditorCmdLine();
  const extraArgs = (process.env.MCP_auditor_ARGS || '').trim();
  const cmdLine = extraArgs ? `${baseCmd} ${extraArgs}` : baseCmd;

  // Defaults derivados del repo hermano si está presente
  const defaults = defaultAuditorCwdAndEnv();

  return {
    // ---- Servidor Bevstack Auditor (actual) ----
    auditor: {
      cmdLine,
      // Precedencia de cwd: env explícito → default basado en repo hermano → sin cwd
      cwd: (process.env.MCP_auditor_CWD || '').trim() || defaults.cwd,
      env: {
        // Defaults (manifest detectado) primero, y luego overrides explícitos
        ...(defaults.env || {}),
        ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
        ...(process.env.MCP_auditor_MANIFEST ? { MCP_MANIFEST_PATH: process.env.MCP_auditor_MANIFEST } : {}),
      },
    },

    // ---- Ejemplo de cómo registrar otro MCP en el futuro ----
    // search: {
    //   cmdLine: (process.env.MCP_search_CMD || 'node ../mcp-search/bin/server.js').trim(),
    //   cwd: (process.env.MCP_search_CWD || '').trim() || undefined,
    //   env: {
    //     ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
    //     ...(process.env.MCP_search_MANIFEST ? { MCP_MANIFEST_PATH: process.env.MCP_search_MANIFEST } : {}),
    //   },
    // },
  };
}