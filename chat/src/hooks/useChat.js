import { useCallback, useRef, useState } from 'react';

export default function useChat() {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  /**
   * Envía un mensaje al endpoint /api/chat.
   * opts:
   *  - messages?: Array<{role?:'user'|'assistant', isBot?:boolean, content:string}>
   *  - model?: string
   *  - temperature?: number
   *  - max_tokens?: number
   *  - onDelta?: (chunk: string, full: string) => void
   *  - onStart?: () => void
   *  - onDone?: (full: string) => void
   *  - onError?: (err: Error) => void
   */
  const sendMessage = useCallback(async (userText, opts = {}) => {
    const {
      messages,
      model,
      temperature,
      max_tokens,
      onDelta,
      onStart,
      onDone,
      onError,
    } = opts;

    setIsSending(true);
    setError(null);

    // Si había una request anterior, abortarla antes de iniciar otra
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    abortRef.current = new AbortController();

    try {
      const payload = {};
      // Historial → formato Claude {role, content}
      const outMsgs = normalizeOutgoingMessages(messages);

      if (outMsgs.length > 0) {
        payload.messages = outMsgs;
      } else {
        payload.content = String(userText ?? '');
      }

      if (typeof model === 'string' && model) payload.model = model;
      if (Number.isFinite(temperature)) payload.temperature = Number(temperature);
      if (Number.isFinite(max_tokens)) payload.max_tokens = Number(max_tokens);

      onStart?.();

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

      // Non-stream fallback (cuando el body no es legible como stream)
      if (!res.body) {
        const json = await res.json().catch(() => ({}));
        const text = extractTextFromNonStream(json);
        if (text) {
          onDelta?.(text, text);
          onDone?.(text);
        }
        return text;
      }

      // NDJSON streaming: líneas JSON. También tolera prefijo "data:"
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
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);

          line = line.trim();
          if (!line) continue;

          // tolera "data: {json}"
          if (line.startsWith('data:')) {
            line = line.slice(5).trim();
            if (!line || line === '[DONE]') continue;
          }

          let evt;
          try { evt = JSON.parse(line); } catch { continue; }

          if (evt.type === 'delta') {
            const chunk = String(evt.text || '');
            if (chunk) {
              full += chunk;
              onDelta?.(chunk, full);
            }
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'stream error');
          } else if (evt.type === 'done') {
            onDone?.(full);
            return full;
          }
        }
      }

      onDone?.(full);
      return full;
    } catch (e) {
      setError(e);
      onError?.(e);
      throw e;
    } finally {
      setIsSending(false);
      // No reseteamos abortRef para poder cancelar desde fuera
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

/**
 * Extrae texto de una respuesta no–stream.
 * Soporta:
 *  - Tu API: { text: "..." }
 *  - Formato Anthropic: { content: [{type:'text', text:'...'}, ...] }
 */
function extractTextFromNonStream(json) {
  if (!json || typeof json !== 'object') return '';
  // Forma de tu /api/chat en modo non-stream
  if (typeof json.text === 'string') return json.text;

  // Forma Anthropic "content"
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

/**
 * Normaliza una lista heterogénea (UI o Claude) a la forma esperada por /api/chat:
 *   [{ role: 'user'|'assistant', content: string }]
 * Acepta items con {role} o con {isBot}.
 */
function normalizeOutgoingMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  return messages.map((m) => {
    const role =
      m?.role === 'assistant' || m?.isBot === true
        ? 'assistant'
        : 'user';

    return {
      role,
      content: String(m?.content ?? ''),
    };
  });
}