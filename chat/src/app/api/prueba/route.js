export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import path from 'node:path';
import { loadTemplatePack, scoreAgainstPack } from '../../../lib/templateMatcher';
import { extractHeadings, htmlToPlain } from '../../../lib/sections';

const ROOT = process.cwd();
const TEMPLATE_PATHS = {
  privacy: path.join(ROOT, 'src/app/api/templates/PP.pdf'),
  terms:   path.join(ROOT, 'src/app/api/templates/TOS.pdf'),
  faq:     path.join(ROOT, 'src/app/api/templates/CS.pdf'),
};

const ENABLE_SPELLCHECK = true;

const CANDIDATE_TAILS = {
  privacy: ['privacy', 'privacy-policy', 'policy', 'policies'],
  terms:   ['terms', 'terms-of-service', 'terms-and-conditions', 'legal'],
  faq:     ['faq', 'faqs', 'help', 'support'],
};

const TYPES = /** @type {const} */ (['privacy', 'terms', 'faq']);
const PASS_THRESHOLD = 80;
const FAQ_SOFT_PASS  = 60;
const TIMEOUT_MS     = 12000;

const SPELL_WHITELIST = [
  'bevstack','mezcal','anejo','añejo','reposado','blanco','joven',
  'añada','tequila','raicilla','bacanora','sotol','sku','skus',
  'ecommerce','shopify','fulfillment','drizly','instacart'
];

const REQUIRED_SECTIONS = {
  privacy: ['personal information','cookies','tracking','data security','your rights','contact'],
  terms:   ['limitation of liability','governing law','jurisdiction','returns','refunds','shipping'],
  faq:     ['shipping','delivery','tracking','returns','refund','exchange']
};

function normalizeOrigin(userUrl) {
  const u = new URL(userUrl);
  return `${u.protocol}//${u.hostname}`;
}

async function fetchWithTimeout(url, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'BevstackAuditor/1.0 (+https://bevstack.io)' }
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function findCandidateLink(homeHtml, origin, tails) {
  const links = [];
  const re = /<a\s+[^>]*href\s*=\s*"(.*?)"[^>]*>/gi;
  let m;
  while ((m = re.exec(homeHtml)) !== null) {
    const href = m[1]; if (!href) continue;
    try {
      const abs = new URL(href, origin).toString();
      links.push(abs.toLowerCase());
    } catch {}
  }
  for (const link of links) {
    if (tails.some((t) => link.includes(`/${t}`) || link.endsWith(`/${t}`))) return link;
  }
  return null;
}

async function getPage(origin, homeHtml, type) {
  const tails = CANDIDATE_TAILS[type];
  let url = findCandidateLink(homeHtml, origin, tails);

  if (!url) {
    for (const t of tails) {
      const guess = `${origin}/${t}`;
      try {
        const r = await fetchWithTimeout(guess, 6000);
        if (r.ok) { url = guess; break; }
      } catch {}
    }
  }

  if (!url) return { type, foundAt: null, text: '', headings: { h1: [], h2: [], h3: [] } };

  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { type, foundAt: url, text: '', headings: { h1: [], h2: [], h3: [] } };
    const html = await r.text();
    return { type, foundAt: url, text: htmlToPlain(html), headings: extractHeadings(html) };
  } catch {
    return { type, foundAt: url, text: '', headings: { h1: [], h2: [], h3: [] } };
  }
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 });

    const origin = normalizeOrigin(url);

    // 1) Templates (PDF -> texto)
    let templates;
    try {
      templates = await loadTemplatePack(TEMPLATE_PATHS);
    } catch (tplErr) {
      return NextResponse.json({ error: String(tplErr?.message || tplErr) }, { status: 500 });
    }

    // 2) Homepage
    const homeRes = await fetchWithTimeout(origin);
    if (!homeRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch homepage: ${homeRes.status}` },
        { status: 502 }
      );
    }
    const homeHtml = (await homeRes.text()).toLowerCase();

    // 3) Candidatas
    const collected = [];
    for (const type of TYPES) {
      // eslint-disable-next-line no-await-in-loop
      const pr = await getPage(origin, homeHtml, type);
      collected.push(pr);
    }

    // 4) TF-IDF vs templates
    const siteTexts = {
      privacy: collected.find((p) => p.type === 'privacy')?.text || '',
      terms:   collected.find((p) => p.type === 'terms')?.text   || '',
      faq:     collected.find((p) => p.type === 'faq')?.text     || '',
    };
    const scores = scoreAgainstPack(templates, siteTexts);

    // 5) Páginas + spellcheck tolerante
    const pages = [];
    for (const p of collected) {
      const similarity = scores[p.type]?.similarity ?? 0;

      // secciones mínimas
      const required = REQUIRED_SECTIONS[p.type] || [];
      const sectionsFound = [];
      const sectionsMissing = [];
      for (const s of required) {
        if (p.text.includes(s.toLowerCase())) sectionsFound.push(s);
        else sectionsMissing.push(s);
      }

      const passBySimilarity = p.type === 'faq'
        ? similarity >= FAQ_SOFT_PASS
        : similarity >= PASS_THRESHOLD;
      const passBySections = sectionsMissing.length === 0;
      const pass = !!p.foundAt && passBySimilarity && passBySections;

      if (p.foundAt && !passBySimilarity) {
        sectionsMissing.push(
          p.type === 'faq'
            ? `Below ${FAQ_SOFT_PASS}% similarity to template`
            : `Below ${PASS_THRESHOLD}% similarity to template`
        );
      }

      // spellcheck (si falla, no rompe)
      let typos = [];
      let rate  = 0;
      if (ENABLE_SPELLCHECK && p.text) {
        try {
          const { spellcheckText, typoRate } = await import('../../../lib/spellcheck.js');
          const totalWords = (p.text.match(/\b[a-zA-Z]+\b/g) || []).length;
          const errs = await spellcheckText(p.text, { whitelist: SPELL_WHITELIST, maxErrors: 20 });
          typos = errs.slice(0, 5);
          rate = typoRate(errs.length, totalWords);
        } catch (e) {
          // deja trazas para debug pero no rompe la respuesta
          console.warn('[spellcheck] disabled due to error:', e?.message || e);
        }
      }

      const out = {
        type: p.type,
        foundAt: p.foundAt,
        similarity,
        sectionsFound,
        sectionsMissing,
        typos,
        typoRate: rate,
        pass,
        headings: p.headings || { h1: [], h2: [], h3: [] }
      };
      if (p.type === 'faq') out.qaCount = (p.text.match(/\?/g) || []).length;
      pages.push(out);
    }

    // 6) score global
    const present = pages.filter((p) => p.foundAt);
    const overallScore = present.length
      ? Math.round(present.reduce((s, p) => s + (p.similarity || 0), 0) / present.length)
      : 0;
    const overallPass = pages.every((p) => p.pass);

    return NextResponse.json({
      language: 'en',
      domain: new URL(origin).hostname,
      overallPass,
      overallScore,
      pages,
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}