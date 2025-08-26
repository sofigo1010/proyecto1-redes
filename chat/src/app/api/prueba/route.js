// app/api/prueba/route.js
// Step 5: Wire PDFs (EN) via TF-IDF similarity using src/lib/templateMatcher.js
// Requires: npm i pdf-parse
import { NextResponse } from 'next/server';
import { loadTemplatePack, scoreAgainstPack } from '@/src/lib/templateMatcher';

// ---- Config: put your 3 PDFs in /templates (relative to project root)
const TEMPLATE_PATHS = {
  privacy: 'templates/Privacy Policy for brand partners 2025.docx.pdf',
  terms: 'templates/Terms of Service for brand partners 2025.docx.pdf',
  faq: 'templates/Customer Service FAQ - 2025.pdf',
};

const CANDIDATE_TAILS = {
  privacy: ['privacy', 'privacy-policy', 'policy', 'policies'],
  terms: ['terms', 'terms-of-service', 'terms-and-conditions', 'legal'],
  faq: ['faq', 'faqs', 'help', 'support', 'knowledge', 'questions'],
};

const TYPE_ORDER = ['privacy', 'terms', 'faq'];
const TIMEOUT_MS = 12_000;
const PASS_THRESHOLD = 80; // pass if similarity >= 80

function normalizeOrigin(userUrl) {
  const u = new URL(userUrl);
  return `${u.protocol}//${u.hostname}`;
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), opts.timeout ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findCandidateLink(html, origin, tails) {
  const anchorRegex = /<a\s+[^>]*href\s*=\s*"(.*?)"[^>]*>(.*?)<\/a>/gi;
  let match;
  const links = [];
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    let absolute;
    try {
      absolute = new URL(href, origin).toString();
    } catch {
      continue;
    }
    links.push(absolute);
  }
  for (const link of links) {
    const lower = link.toLowerCase();
    if (tails.some((t) => lower.includes(`/${t}`) || lower.endsWith(`/${t}`))) {
      return link;
    }
  }
  return null;
}

async function getPageTextForType(origin, homepageHtml, type) {
  const tails = CANDIDATE_TAILS[type];
  let url = findCandidateLink(homepageHtml, origin, tails);

  if (!url) {
    for (const t of tails) {
      const guess = `${origin}/${t}`;
      try {
        const r = await fetchWithTimeout(guess, { timeout: 6000 });
        if (r.ok) {
          url = guess;
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!url) {
    return { type, foundAt: null, text: '' };
  }

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return { type, foundAt: url, text: '' };
    }
    const html = await res.text();
    const text = htmlToText(html);
    return { type, foundAt: url, text };
  } catch {
    return { type, foundAt: url, text: '' };
  }
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: 'URL required' }, { status: 400 });
    }

    const origin = normalizeOrigin(url);

    // 1) Load templates from PDFs (once per request; you can memoize if needed)
    const templates = await loadTemplatePack(TEMPLATE_PATHS); // { privacy, terms, faq } as text

    // 2) Fetch homepage
    const homeRes = await fetchWithTimeout(origin);
    if (!homeRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch homepage: ${homeRes.status}` },
        { status: 502 }
      );
    }
    const homepageHtml = await homeRes.text();

    // 3) Collect candidate page texts
    const pageResults = [];
    for (const t of TYPE_ORDER) {
      // eslint-disable-next-line no-await-in-loop
      const pr = await getPageTextForType(origin, homepageHtml, t);
      pageResults.push(pr);
    }

    // 4) Score each type against its PDF template
    const siteTexts = {
      privacy: pageResults.find((p) => p.type === 'privacy')?.text || '',
      terms: pageResults.find((p) => p.type === 'terms')?.text || '',
      faq: pageResults.find((p) => p.type === 'faq')?.text || '',
    };
    const scores = scoreAgainstPack(templates, siteTexts); // { privacy:{similarity}, ... }

    // 5) Build response
    const pages = pageResults.map((p) => {
      const sim = scores[p.type]?.similarity ?? 0;
      const pass = p.foundAt && sim >= PASS_THRESHOLD;
      const sectionsMissing = [];
      if (!p.foundAt) sectionsMissing.push('Not found');
      if (p.foundAt && !pass) sectionsMissing.push('Below 80% similarity to template');
      const out = {
        type: p.type,
        foundAt: p.foundAt,
        similarity: sim,
        sectionsMissing,
        typos: [], // spellcheck (en-US) will be added in the next step
        pass,
      };
      if (p.type === 'faq') {
        const qCount = (p.text.match(/\?/g) || []).length;
        out.qaCount = qCount;
      }
      return out;
    });

    const present = pages.filter((p) => p.foundAt);
    const avg = present.length
      ? Math.round(present.reduce((s, p) => s + (p.similarity || 0), 0) / present.length)
      : 0;

    // overall pass = all present and each >= 80, FAQ can be soft-fail if >=60 (optional tweak)
    const overallPass = pages.every((p) =>
      p.type === 'faq' ? (p.foundAt && p.similarity >= 60) : p.pass
    );

    return NextResponse.json({
      language: 'en',
      domain: new URL(origin).hostname,
      overallPass,
      overallScore: avg,
      pages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}