// Utilidades de rutas/archivos para acceder a assets del paquete (PDFs, diccionarios).
// Garantiza:
//  - Resolución desde la raíz del paquete (no desde CWD del integrador).
//  - Que la ruta final quede DENTRO del paquete (evita path traversal).
//  - Checks simples de existencia/tipo/size.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Estructura del repo: src/lib/util/ -> ../../.. = raíz del paquete
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');
export const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');
export const TEMPLATES_DIR = path.join(ASSETS_DIR, 'templates');
export const DICTS_DIR = path.join(ASSETS_DIR, 'dictionaries');

/** Une segmentos respecto a la raíz del paquete. */
export function fromRoot(...segments) {
  const abs = path.resolve(PROJECT_ROOT, ...segments);
  return ensureInside(PROJECT_ROOT, abs);
}

/** Une segmentos respecto a /assets. */
export function fromAssets(...segments) {
  const abs = path.resolve(ASSETS_DIR, ...segments);
  return ensureInside(ASSETS_DIR, abs);
}

/** Une segmentos respecto a /assets/templates. */
export function fromTemplates(...segments) {
  const abs = path.resolve(TEMPLATES_DIR, ...segments);
  return ensureInside(TEMPLATES_DIR, abs);
}

/** Une segmentos respecto a /assets/dictionaries. */
export function fromDicts(...segments) {
  const abs = path.resolve(DICTS_DIR, ...segments);
  return ensureInside(DICTS_DIR, abs);
}

/** Asegura que `absPath` permanezca dentro de `baseDir`. */
export function ensureInside(baseDir, absPath) {
  const rel = path.relative(baseDir, absPath);
  // Si empieza con .. o introduce separadores de raíz, está fuera
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${absPath}`);
  }
  return absPath;
}

/** true si el path existe. */
export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Lanza si no existe o no es archivo regular. */
export async function assertFile(p, label = 'file') {
  let st;
  try {
    st = await fs.stat(p);
  } catch {
    throw new Error(`${label} not found: ${p}`);
  }
  if (!st.isFile()) {
    throw new Error(`${label} is not a regular file: ${p}`);
  }
  return p;
}

/** Devuelve tamaño en bytes o lanza si no es archivo. */
export async function fileSize(p) {
  const st = await fs.stat(p);
  if (!st.isFile()) throw new Error(`Not a file: ${p}`);
  return st.size;
}

/** Lee archivo como UTF-8 tras verificar que es archivo. */
export async function readUtf8(p) {
  await assertFile(p);
  return fs.readFile(p, 'utf8');
}

/** Resuelve y valida ruta a un template PDF (p. ej. 'PP.pdf'). */
export async function resolveTemplatePdf(name) {
  const abs = fromTemplates(name);
  await assertFile(abs, 'template');
  return abs;
}

/** Resuelve y valida ruta a un diccionario (p. ej. 'en_US.dic'). */
export async function resolveDict(name) {
  const abs = fromDicts(name);
  await assertFile(abs, 'dictionary');
  return abs;
}

/** Paths de conveniencia (solo lectura). */
export const PATHS = Object.freeze({
  PROJECT_ROOT,
  ASSETS_DIR,
  TEMPLATES_DIR,
  DICTS_DIR,
});

export default {
  PROJECT_ROOT,
  ASSETS_DIR,
  TEMPLATES_DIR,
  DICTS_DIR,
  PATHS,
  fromRoot,
  fromAssets,
  fromTemplates,
  fromDicts,
  ensureInside,
  exists,
  assertFile,
  fileSize,
  readUtf8,
  resolveTemplatePdf,
  resolveDict,
};