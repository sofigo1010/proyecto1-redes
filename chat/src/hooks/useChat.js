// Client-side hook to call /api/chat with NDJSON streaming.
// Now supports passing a full "messages" array so Claude gets full context.
// API: sendMessage(text, { messages, model, temperature, max_tokens, onDelta })

import { useCallback, useRef, useState } from 'react';

export default function useChat() {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const sendMessage = useCallback(async (userText, opts = {}) => {
    const { messages, model, temperature, max_tokens, onDelta } = opts;
    setIsSending(true);
    setError(null);

    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    abortRef.current = new AbortController();

    try {
      const payload = {};
      // Si pasas "messages", usamos el formato con historial completo
      if (Array.isArray(messages) && messages.length > 0) {
        payload.messages = messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content ?? ''),
        }));
      } else {
        payload.content = String(userText ?? '');
      }

      if (typeof model === 'string' && model) payload.model = model;
      if (Number.isFinite(temperature)) payload.temperature = temperature;
      if (Number.isFinite(max_tokens)) payload.max_tokens = max_tokens;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const txt = await safeText(res);
        throw new Error(`HTTP ${res.status}: ${txt || 'Upstream error'}`);
      }

      if (!res.body) {
        // non-stream fallback
        const json = await res.json().catch(() => ({}));
        const text = extractTextFromNonStream(json);
        if (typeof onDelta === 'function' && text) onDelta(text, text);
        return text;
      }

      // NDJSON streaming: {type:'delta'|'error'|'done', ...}
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });

        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let evt;
          try { evt = JSON.parse(line); } catch { continue; }

          if (evt.type === 'delta') {
            const chunk = String(evt.text || '');
            if (chunk) {
              full += chunk;
              if (typeof onDelta === 'function') onDelta(chunk, full);
            }
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'stream error');
          } else if (evt.type === 'done') {
            return full;
          }
        }
      }
      return full;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setIsSending(false);
    }
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
      setIsSending(false);
    }
  }, []);

  return { isSending, error, sendMessage, cancel };
}

function extractTextFromNonStream(json) {
  try {
    const parts = json?.content || [];
    return parts
      .filter(p => p?.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('') || '';
  } catch {
    return '';
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}