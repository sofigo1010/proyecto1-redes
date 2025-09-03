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
// Para "filesystem":
//   - MCP_filesystem_CMD / _ARGS / _CWD  (sin MANIFEST)
//     Por defecto: usa bin local ../mcp-filesystem/node_modules/.bin/mcp-server-filesystem
//     ARGS por defecto: ".." (permite el repo raíz como directorio permitido)
//
// Para "git":
//   - MCP_git_CMD / _ARGS / _CWD  (sin MANIFEST)
//     Por defecto: usa ../mcp-git/.venv/bin/mcp-server-git si existe, o "mcp-server-git" del PATH
//     ARGS por defecto: "--repository .."
//
// Además, si existe un repo hermano ../mcp-auditor, se detecta y se
// construye un default razonable: `node ../mcp-auditor/bin/mcp-auditor.js`
// con cwd en ese repo y MCP_MANIFEST_PATH apuntando a su manifest.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Ubica la carpeta chat/ (este archivo vive en chat/src/config). */
function getChatDir() {
  return path.resolve(__dirname, '..', '..');
}

/**
 * ------- AUDITOR (Node) -------
 * Defaults basados en repo hermano ../mcp-auditor
 */
function siblingAuditorPaths() {
  const chatDir = getChatDir();
  const repoDir = path.resolve(chatDir, '../mcp-auditor');
  const binJs = path.join(repoDir, 'bin', 'mcp-auditor.js');
  const manifest = path.join(repoDir, 'mcp.manifest.json');
  return { repoDir, binJs, manifest };
}

function defaultAuditorCmdLine() {
  const envLine = (process.env.MCP_auditor_CMD || '').trim();
  if (envLine) return envLine;

  const { binJs } = siblingAuditorPaths();
  if (fs.existsSync(binJs)) {
    // Usa el Node actual para evitar discrepancias de versión
    return `${process.execPath} ${binJs}`;
  }
  // Fallback: bin global
  return 'mcp-auditor';
}

function defaultAuditorCwdAndEnv() {
  const out = { cwd: undefined, env: {} };
  const { repoDir, manifest } = siblingAuditorPaths();
  if (fs.existsSync(repoDir)) out.cwd = repoDir;
  if (!process.env.MCP_auditor_MANIFEST && fs.existsSync(manifest)) {
    out.env.MCP_MANIFEST_PATH = manifest;
  }
  return out;
}

/**
 * ------- FILESYSTEM (Node) -------
 * Defaults basados en repo hermano ../mcp-filesystem
 */
function siblingFilesystemPaths() {
  const chatDir = getChatDir();
  const repoDir = path.resolve(chatDir, '../mcp-filesystem');
  // Bin típico instalado por npm
  const binLocal = path.join(repoDir, 'node_modules', '.bin', 'mcp-server-filesystem');
  return { repoDir, binLocal };
}

function defaultFilesystemCmdLine() {
  const envLine = (process.env.MCP_filesystem_CMD || '').trim();
  if (envLine) return envLine;

  const { binLocal } = siblingFilesystemPaths();
  if (fs.existsSync(binLocal)) return binLocal;

  // Fallback: bin global (vía npx/PATH)
  return 'mcp-server-filesystem';
}

function defaultFilesystemCwd() {
  const { repoDir } = siblingFilesystemPaths();
  return fs.existsSync(repoDir) ? repoDir : undefined;
}

/**
 * ------- GIT (Python) -------
 * Defaults basados en repo hermano ../mcp-git
 */
function siblingGitPaths() {
  const chatDir = getChatDir();
  const repoDir = path.resolve(chatDir, '../mcp-git');
  // Virtualenv típico en macOS/Linux
  const venvBin = path.join(repoDir, '.venv', 'bin', 'mcp-server-git');
  return { repoDir, venvBin };
}

function defaultGitCmdLine() {
  const envLine = (process.env.MCP_git_CMD || '').trim();
  if (envLine) return envLine;

  const { venvBin } = siblingGitPaths();
  if (fs.existsSync(venvBin)) return venvBin;

  // Fallback: bin global del PATH (pipx/uvx/pip install --user)
  return 'mcp-server-git';
}

function defaultGitCwd() {
  const { repoDir } = siblingGitPaths();
  return fs.existsSync(repoDir) ? repoDir : undefined;
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
  // ===== Auditor =====
  const auditorBaseCmd = defaultAuditorCmdLine();
  const auditorExtraArgs = (process.env.MCP_auditor_ARGS || '').trim();
  const auditorCmdLine = auditorExtraArgs ? `${auditorBaseCmd} ${auditorExtraArgs}` : auditorBaseCmd;
  const auditorDefaults = defaultAuditorCwdAndEnv();

  // ===== Filesystem =====
  const fsBaseCmd = defaultFilesystemCmdLine();
  // Por defecto, permitir el repo raíz (carpeta padre de chat/) como directorio permitido
  const fsDefaultArgs = '..';
  const fsExtraArgs = (process.env.MCP_filesystem_ARGS || fsDefaultArgs).trim();
  const fsCmdLine = fsExtraArgs ? `${fsBaseCmd} ${fsExtraArgs}` : fsBaseCmd;
  const fsCwd = (process.env.MCP_filesystem_CWD || '').trim() || defaultFilesystemCwd();

  // ===== Git =====
  const gitBaseCmd = defaultGitCmdLine();
  // Por defecto, apuntar al repo raíz como --repository ..
  const gitDefaultArgs = '--repository ..';
  const gitExtraArgs = (process.env.MCP_git_ARGS || gitDefaultArgs).trim();
  const gitCmdLine = gitExtraArgs ? `${gitBaseCmd} ${gitExtraArgs}` : gitBaseCmd;
  const gitCwd = (process.env.MCP_git_CWD || '').trim() || defaultGitCwd();

  return {
    // ---- Servidor Bevstack Auditor ----
    auditor: {
      cmdLine: auditorCmdLine,
      // Precedencia de cwd: env explícito → default basado en repo hermano → sin cwd
      cwd: (process.env.MCP_auditor_CWD || '').trim() || auditorDefaults.cwd,
      env: {
        // Defaults (manifest detectado) primero, y luego overrides explícitos
        ...(auditorDefaults.env || {}),
        ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
        ...(process.env.MCP_auditor_MANIFEST ? { MCP_MANIFEST_PATH: process.env.MCP_auditor_MANIFEST } : {}),
      },
    },

    // ---- Servidor Filesystem (oficial MCP) ----
    filesystem: {
      cmdLine: fsCmdLine,
      cwd: fsCwd,
      env: {
        ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
      },
    },

    // ---- Servidor Git (oficial MCP) ----
    git: {
      cmdLine: gitCmdLine,
      cwd: gitCwd,
      env: {
        ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
      },
    },

    // ---- Ejemplo de cómo registrar otro MCP en el futuro ----
    // search: {
    //   cmdLine: (process.env.MCP_search_CMD || 'node ../mcp-search/bin/server.js').trim(),
    //   cwd: (process.env.MCP_search_CWD || '').trim() || undefined,
    //   env: {
    //     ...(process.env.MCP_LOG_LEVEL ? { LOG_LEVEL: process.env.MCP_LOG_LEVEL } : {}),
    //   },
    // },
  };
}