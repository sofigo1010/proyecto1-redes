"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'app:chat:sessions:v1';

function uuid() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

const GREETING = () => ({
  id: uuid(),
  content: "¡Hola! Soy Sofig's Chat. ¿En qué puedo ayudarte hoy?",
  isBot: true,
  timestamp: Date.now(),
});

function initialSession() {
  const now = Date.now();
  return {
    id: uuid(),
    title: 'Nueva conversación',
    createdAt: now,
    updatedAt: now,
    active: true,
    messages: [GREETING()],
  };
}

function loadSessions() {
  if (typeof window === 'undefined') return [initialSession()];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [initialSession()];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return [initialSession()];
    // Ensure one active
    if (!arr.some(s => s.active)) arr[0].active = true;
    return arr;
  } catch {
    return [initialSession()];
  }
}

function saveSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {}
}

export default function useChatSessions() {
  const [sessions, setSessions] = useState(() => loadSessions());
  const activeSession = useMemo(
    () => sessions.find(s => s.active) || sessions[0],
    [sessions]
  );

  // persist
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const setActiveById = useCallback((id) => {
    setSessions(prev =>
      prev.map(s => ({ ...s, active: s.id === id }))
    );
  }, []);

  const newSession = useCallback(() => {
    setSessions(prev => prev.map(s => ({ ...s, active: false })).concat(initialSession()));
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) return [initialSession()];
      // keep one active
      if (!filtered.some(s => s.active)) filtered[filtered.length - 1].active = true;
      return filtered;
    });
  }, []);

  const renameSession = useCallback((id, title) => {
    setSessions(prev =>
      prev.map(s => (s.id === id ? { ...s, title: String(title || 'Untitled'), updatedAt: Date.now() } : s))
    );
  }, []);

  const messages = activeSession?.messages || [];

  const appendMessage = useCallback((msg) => {
    setSessions(prev =>
      prev.map(s => {
        if (!s.active) return s;
        const messages = [...s.messages, { ...msg, id: msg.id || uuid(), timestamp: Date.now() }];
        let title = s.title;
        // Si es la primera intervención del user, auto-titula con snippet
        const userMsgs = messages.filter(m => !m.isBot);
        if (userMsgs.length === 1 && (title === 'Nueva conversación' || !title?.trim())) {
          title = userMsgs[0].content.slice(0, 40);
        }
        return { ...s, messages, title, updatedAt: Date.now() };
      })
    );
  }, []);

  const updateMessage = useCallback((id, patch) => {
    setSessions(prev =>
      prev.map(s => {
        if (!s.active) return s;
        const messages = s.messages.map(m => (m.id === id ? { ...m, ...patch } : m));
        return { ...s, messages, updatedAt: Date.now() };
      })
    );
  }, []);

  const clearActive = useCallback(() => {
    setSessions(prev =>
      prev.map(s => (s.active ? { ...s, messages: [GREETING()], updatedAt: Date.now() } : s))
    );
  }, []);

  const chatHistory = useMemo(
    () =>
      sessions
        .map(s => ({
          id: s.id,
          title: s.title,
          timestamp: new Date(s.updatedAt || s.createdAt || Date.now()),
          active: !!s.active,
        }))
        .sort((a, b) => b.timestamp - a.timestamp),
    [sessions]
  );

  return {
    sessions,
    chatHistory,
    activeSession,
    messages,
    newSession,
    setActiveById,
    deleteSession,
    renameSession,
    appendMessage,
    updateMessage,
    clearActive,
  };
}