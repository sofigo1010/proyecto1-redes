import { load } from 'cheerio';

/**
 * @typedef {Object} FindOpts
 * @property {boolean} [sameHostOnly=false]
 * @property {string}  [requireKeyword]  
 */

export function findCandidateLink(homeHtml, origin, tails, opts = {}) {
  if (!homeHtml || !origin || !Array.isArray(tails) || tails.length === 0) return null;

  let base;
  try { base = new URL(origin); } catch { return null; }

  const $ = load(homeHtml, { decodeEntities: true });
  const wantSameHost = !!opts.sameHostOnly;
  const must = (opts.requireKeyword || '').toLowerCase(); 

  const resolveHref = (href) => {
    if (!href || typeof href !== 'string') return null;
    const h = href.trim();
    if (!h || h === '#' || h.startsWith('javascript:') || h.startsWith('mailto:') || h.startsWith('tel:')) return null;
    try { return new URL(h, base).toString(); } catch { return null; }
  };

  const matchesTails = (urlLower) => {
    for (const t of tails) {
      const tail = `/${String(t).toLowerCase()}`;
      if (urlLower.includes(tail) || urlLower.endsWith(tail)) return true;
    }
    return false;
  };

  const anchors = $('a[href]');
  for (let i = 0; i < anchors.length; i++) {
    const el = anchors[i];
    const abs = resolveHref($(el).attr('href'));
    if (!abs) continue;

    if (wantSameHost) {
      try { if (new URL(abs).hostname !== base.hostname) continue; } catch { continue; }
    }

    const low = abs.toLowerCase();

    if (must && !low.includes(must)) continue;

    if (matchesTails(low)) return abs;
  }

  return null;
}

export default findCandidateLink;