'use client';

import { useState } from 'react';

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
      // Validación mínima de URL
      const u = new URL(url);
      if (!u.protocol.startsWith('http')) throw new Error('URL inválida');

      setLoading(true);

      // ⚠️ En el siguiente paso haremos este endpoint.
      // Aquí solo dejamos el fetch listo para usar con la API.
      const res = await fetch('/api/prueba', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Error al auditar la URL');
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err?.message || 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>
        Auditor básico (Privacy Policy · Terms of Service · FAQ)
      </h1>
      <p style={{ color: '#555', marginBottom: 20 }}>
        Ingresa una URL y comprobaré si la estructura existe y qué tan “parecida” es a tus plantillas.
        (El análisis con <strong>ANTLR</strong> lo conectamos en el siguiente paso, desde la API).
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="url"
          placeholder="https://ejemplo.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #ddd'
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
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Analizando…' : 'Auditar'}
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
            marginBottom: 12
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
            background: '#fafafa'
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <strong>Dominio:</strong> {result.domain || '—'}
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong>Estado general:</strong>{' '}
            {result.overallPass ? 'OK ✅' : 'Revisar ❗'}
            {typeof result.overallScore === 'number' && (
              <span> • score: {Math.round(result.overallScore)}%</span>
            )}
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {(result.pages || []).map((p) => (
              <li
                key={p.type}
                style={{
                  background: '#fff',
                  border: '1px solid #eee',
                  borderRadius: 8,
                  padding: 12
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                  {p.type?.toUpperCase() || 'PAGE'}
                  {' • '}
                  {p.pass ? 'OK ✅' : 'Falta/Insuficiente ❗'}
                  {typeof p.similarity === 'number' && (
                    <span> • similitud: {Math.round(p.similarity)}%</span>
                  )}
                </div>

                {p.foundAt && (
                  <div style={{ marginBottom: 6 }}>
                    <strong>Encontrado en:</strong>{' '}
                    <a href={p.foundAt} target="_blank" rel="noreferrer">
                      {p.foundAt}
                    </a>
                  </div>
                )}

                {Array.isArray(p.sectionsMissing) && p.sectionsMissing.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <strong>Secciones faltantes:</strong> {p.sectionsMissing.join(', ')}
                  </div>
                )}

                {Array.isArray(p.typos) && p.typos.length > 0 && (
                  <div>
                    <strong>Typos:</strong>{' '}
                    {p.typos
                      .slice(0, 5)
                      .map((t) => (typeof t === 'string' ? t : t.word))
                      .join(', ')}
                    {p.typos.length > 5 ? '…' : ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}