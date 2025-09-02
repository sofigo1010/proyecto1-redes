// Unified message helpers for the UI + Claude bridging.
// Se centraliza cómo se crean, normalizan, serializan y transforman mensajes
// tanto para la UI (isBot/timestamp) como para el payload de LLM (role/content).

let _nextId = 2;

/**
 * @typedef {Object} UIMsg
 * @property {number|string} id
 * @property {string} content
 * @property {boolean} isBot
 * @property {Date} timestamp
 * @property {'user'|'assistant'=} role  // opcional: si está, se usa para inferir isBot
 */

// -------------------------- Builders (UI) --------------------------

export function makeUserMessage(content, { id, timestamp } = {}) {
  return {
    id: id ?? _genId(),
    content: String(content ?? ''),
    isBot: false,
    timestamp: normalizeTs(timestamp),
    role: 'user',
  };
}

export function makeAssistantMessage(content = '', { id, timestamp } = {}) {
  return {
    id: id ?? _genId('a'),
    content: String(content ?? ''),
    isBot: true,
    timestamp: normalizeTs(timestamp),
    role: 'assistant',
  };
}

// -------------------------- Normalization --------------------------

/**
 * Normaliza un objeto suelto a UIMsg (best-effort).
 * Desconocidos se ignoran; faltantes reciben defaults.
 */
export function toUiMessage(m) {
  if (!m || typeof m !== 'object') {
    return makeAssistantMessage('');
  }
  // isBot tiene prioridad; si no está, se infiere desde role.
  const inferredIsBot =
    typeof m.isBot === 'boolean'
      ? m.isBot
      : (m.role === 'assistant');

  return {
    id: m.id ?? _genId(inferredIsBot ? 'a' : undefined),
    content: String(m.content ?? ''),
    isBot: inferredIsBot,
    timestamp: normalizeTs(m.timestamp),
    role: inferredIsBot ? 'assistant' : 'user',
  };
}

/**
 * Normaliza un array heterogéneo a una lista de UIMsg.
 */
export function toUiMessages(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(toUiMessage);
}

// -------------------------- (De)serialización (p.ej. localStorage) --------------------------

/**
 * Serializa un mensaje a una forma JSON-safe.
 */
export function serializeMessage(m) {
  const ts = normalizeTs(m?.timestamp);
  return {
    id: m?.id,
    content: String(m?.content ?? ''),
    isBot: !!m?.isBot,
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    timestamp: ts.toISOString(),
  };
}

/**
 * Deserializa un JSON-safe a UIMsg.
 */
export function deserializeMessage(j) {
  return {
    id: j?.id,
    content: String(j?.content ?? ''),
    isBot: !!j?.isBot,
    role: j?.role === 'assistant' ? 'assistant' : 'user',
    timestamp: normalizeTs(j?.timestamp),
  };
}

// -------------------------- Claude bridging --------------------------

/**
 * Convierte un UIMsg a mensaje para Claude Messages API.
 * Claude espera { role: 'user'|'assistant', content: string }.
 */
export function toClaudeMessage(uiMsg) {
  const m = toUiMessage(uiMsg);
  return {
    role: m.isBot ? 'assistant' : 'user',
    content: m.content,
  };
}

/**
 * Convierte una lista de UIMsg a la lista para Claude.
 */
export function toClaudeMessages(uiMsgs) {
  return (Array.isArray(uiMsgs) ? uiMsgs : []).map(toClaudeMessage);
}

/**
 * Convierte desde el formato Claude (array de {role, content}) a UIMsg[].
 * Útil si en algún flujo regresan mensajes del servidor a la UI.
 */
export function fromClaudeMessages(claudeMsgs = []) {
  if (!Array.isArray(claudeMsgs)) return [];
  return claudeMsgs.map((c) =>
    toUiMessage({
      id: undefined,
      content: c?.content,
      role: c?.role === 'assistant' ? 'assistant' : 'user',
      isBot: c?.role === 'assistant',
      timestamp: new Date(),
    })
  );
}

// -------------------------- Utils --------------------------

/**
 * Normaliza timestamps aceptando Date | string ISO | number epoch | undefined.
 */
function normalizeTs(ts) {
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date();
}

/**
 * Generador rápido en memoria para IDs (suficiente para listas de UI).
 */
function _genId(prefix) {
  const n = _nextId++;
  return prefix ? `${prefix}_${n}` : n;
}