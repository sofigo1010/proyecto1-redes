import { ensureReady, listTools, auditSite, closeAll } from '../src/lib/mcp/facade.js';

const URL = process.env.SMOKE_URL || 'https://mijenta-tequila.com';
const toMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);

async function main() {
  console.log('[smoke] ensureReady(auditor)…');
  await ensureReady('auditor');

  console.log('[smoke] listTools(auditor)…');
  const tools = await listTools('auditor', { timeoutMs: toMs });
  console.log('[smoke] tools =', tools.map(t => t.name).join(', ') || '(none)');

  console.log(`[smoke] auditSite(${URL})…`);
  const report = await auditSite(URL, { timeoutMs: toMs });

  const head = `overallPass=${report?.overallPass} score=${report?.overallScore}`;
  console.log('[smoke] result:', head);
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  for (const p of pages) {
    console.log(
      `  - ${p.type}: ${p.pass ? 'PASS' : 'FAIL'} sim=${p.similarity ?? '—'} missing=${(p.sectionsMissing||[]).length} at=${p.foundAt || p.error || '—'}`
    );
  }

  // dump JSON compacto al final
  console.log('\n[smoke] JSON (truncated):');
  const s = JSON.stringify(report);
  console.log(s.length > 4000 ? s.slice(0, 4000) + '… /* truncated */' : s);
}

main()
  .catch(err => {
    console.error('[smoke] ERROR:', err?.stack || err);
    process.exitCode = 1;
  })
  .finally(() => {
    closeAll();
  });