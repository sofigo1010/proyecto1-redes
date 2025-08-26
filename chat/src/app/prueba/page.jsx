// app/prueba/page.jsx
'use client';

import { useState } from 'react';

function Pill({ ok, children, title }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        border: `1px solid ${ok ? '#16a34a' : '#dc2626'}`,
        color: ok ? '#166534' : '#7f1d1d',
        background: ok ? '#ecfdf5' : '#fee2e2',
        marginRight: 8,
        marginBottom: 6,
      }}
    >
      {children}
    </span>
  );
}

export default function PruebaPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);

    try {
      const u = new URL(url);
      if (!/^https?:/.test(u.protocol)) throw new Error('Invalid URL');

      setLoading(true);
      const res = await fetch('/api/prueba', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Audit error');
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err?.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>
        Site Auditor — Privacy · Terms · FAQ
      </h1>
      <p style={{ color: '#555', marginBottom: 20 }}>
        Enter a homepage URL. We&apos;ll discover Privacy/Terms/FAQ, compare against your PDF templates (TF-IDF), check required sections, spellcheck (en-US), and extract headings.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #ddd',
          }}
        />
        <button
          type="submit"
          disabled={loading || !url}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #111',
            background: loading ? '#eee' : '#111',
            color: loading ? '#111' : '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Analyzing…' : 'Audit'}
        </button>
      </form>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#ffe8e8',
            border: '1px solid #ffb3b3',
            color: '#b10000',
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <section
          style={{
            padding: 16,
            border: '1px solid #eee',
            borderRadius: 12,
            background: '#fafafa',
          }}
        >
          <div style={{ marginBottom: 10 }}>
            <strong>Domain:</strong> {result.domain || '—'}
          </div>

          <div style={{ marginBottom: 16 }}>
            <Pill ok={!!result.overallPass} title="Overall status">
              {result.overallPass ? 'Overall: PASS' : 'Overall: REVIEW'}
            </Pill>
            <Pill ok title="Average similarity">
              Score: {typeof result.overallScore === 'number' ? `${result.overallScore}%` : '—'}
            </Pill>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {(result.pages || []).map((p) => (
              <li
                key={p.type}
                style={{
                  background: '#fff',
                  border: '1px solid #eee',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, textTransform: 'uppercase' }}>
                    {p.type}
                  </div>
                  <Pill ok={!!p.pass}>{p.pass ? 'PASS' : 'REVIEW'}</Pill>
                  <Pill ok={p.similarity >= 80}>
                    Similarity: {p.similarity ?? 0}%
                  </Pill>
                  {'typoRate' in p && (
                    <Pill ok={(p.typoRate ?? 0) <= 1.5}>
                      Typo rate: {p.typoRate ?? 0}%
                    </Pill>
                  )}
                  {p.qaCount !== undefined && (
                    <Pill ok={p.qaCount >= 5}>FAQ Qs: {p.qaCount}</Pill>
                  )}
                </div>

                {p.foundAt && (
                  <div style={{ margin: '8px 0 12px' }}>
                    <strong>Found at:</strong>{' '}
                    <a href={p.foundAt} target="_blank" rel="noreferrer">
                      {p.foundAt}
                    </a>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Sections found</div>
                    <div>
                      {p.sectionsFound?.length > 0 ? (
                        p.sectionsFound.map((s) => (
                          <Pill key={s} ok>{s}</Pill>
                        ))
                      ) : (
                        <div style={{ color: '#666' }}>None</div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Missing / Issues</div>
                    <div>
                      {p.sectionsMissing?.length > 0 ? (
                        p.sectionsMissing.map((s, i) => (
                          <Pill key={`${s}-${i}`} ok={false}>{s}</Pill>
                        ))
                      ) : (
                        <Pill ok>All covered</Pill>
                      )}
                    </div>
                  </div>
                </div>

                {p.typos && p.typos.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      Top typos (max 5)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {p.typos.map((t, idx) => (
                        <li key={idx} style={{ marginBottom: 4 }}>
                          <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>
                            {typeof t === 'string' ? t : t.word}
                          </code>
                          {t?.suggestions?.length ? (
                            <span style={{ color: '#555' }}>
                              {' '}→ suggestions: {t.suggestions.join(', ')}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {p.headings && (p.headings.h1?.length || p.headings.h2?.length || p.headings.h3?.length) ? (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer' }}>Headings found (H1/H2/H3)</summary>
                    <div style={{ marginTop: 8, fontSize: 14 }}>
                      <div><strong>H1:</strong> {p.headings.h1?.join(' | ') || '—'}</div>
                      <div><strong>H2:</strong> {p.headings.h2?.join(' | ') || '—'}</div>
                      <div><strong>H3:</strong> {p.headings.h3?.join(' | ') || '—'}</div>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}