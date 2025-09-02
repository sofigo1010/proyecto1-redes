// src/lib/sections/htmlToPlain.js
// Convierte HTML a texto plano eliminando scripts/estilos y normalizando espacios.

import { load } from 'cheerio';

/**
 * @param {string} html
 * @returns {string} plain text
 */
export function htmlToPlain(html) {
  if (!html || typeof html !== 'string') return '';

  const $ = load(html, { decodeEntities: true });

  // Elimina contenido no textual
  $('script, style, noscript, template').remove();

  // Toma el texto del body (fallback a document si no hay body)
  const text =
    ($('body').text?.() ?? $.root().text?.() ?? '')
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')   // nbsp → espacio
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n') // compacta saltos
      .trim();

  return text;
}

export default htmlToPlain;