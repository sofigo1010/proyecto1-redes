// chat/src/lib/messages.js
// Unified message helpers for the UI.

let _nextId = 2;

/**
 * @typedef {Object} UIMsg
 * @property {number|string} id
 * @property {string} content
 * @property {boolean} isBot
 * @property {Date} timestamp
 */

export function makeUserMessage(content, { id, timestamp } = {}) {
  return {
    id: id ?? _genId(),
    content: String(content ?? ''),
    isBot: false,
    timestamp: timestamp ?? new Date(),
  };
}

export function makeAssistantMessage(content = '', { id, timestamp } = {}) {
  return {
    id: id ?? _genId('a'),
    content: String(content ?? ''),
    isBot: true,
    timestamp: timestamp ?? new Date(),
  };
}

/**
 * Normalize a loose object into a UIMsg (best-effort).
 * Unknown fields are ignored; missing fields get defaults.
 */
export function toUiMessage(m) {
  if (!m || typeof m !== 'object') {
    return makeAssistantMessage('');
  }
  const isBot = !!m.isBot;
  return {
    id: m.id ?? _genId(isBot ? 'a' : undefined),
    content: String(m.content ?? ''),
    isBot,
    timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(),
  };
}

/**
 * Serialize a message to a plain JSON-safe shape (e.g., for localStorage).
 */
export function serializeMessage(m) {
  return {
    id: m.id,
    content: m.content,
    isBot: !!m.isBot,
    timestamp: (m.timestamp instanceof Date ? m.timestamp : new Date()).toISOString(),
  };
}

/**
 * Deserialize from JSON-safe shape back to a UIMsg.
 */
export function deserializeMessage(j) {
  return {
    id: j.id,
    content: String(j.content ?? ''),
    isBot: !!j.isBot,
    timestamp: j.timestamp ? new Date(j.timestamp) : new Date(),
  };
}

/**
 * Quick in-memory id generator (sufficient for UI lists).
 */
function _genId(prefix) {
  const n = _nextId++;
  return prefix ? `${prefix}_${n}` : n;
}