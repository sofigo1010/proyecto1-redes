"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "app:chat:sessions:v1";

/**
 * Genera un id único simple para UI/almacenamiento local.
 */
function uuid() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/**
 * Mensaje de bienvenida inicial (bot).
 */
const GREETING = () => ({
  id: uuid(),
  content: "¡Hola! Soy Sofig's Chat. ¿En qué puedo ayudarte hoy?",
  isBot: true,
  timestamp: Date.now(), // se guarda como number para serializar fácil
});

/**
 * Construye una sesión “vacía” por defecto.
 */
function initialSession() {
  const now = Date.now();
  return {
    id: uuid(),
    title: "Nueva conversación",
    createdAt: now,
    updatedAt: now,
    active: true,
    messages: [GREETING()],
  };
}

/**
 * Carga sesiones desde localStorage (o crea una por defecto).
 * Se asegura de que al menos una esté marcada como activa.
 */
function loadSessions() {
  if (typeof window === "undefined") return [initialSession()];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [initialSession()];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return [initialSession()];
    ensureOneActive(arr);
    return arr;
  } catch {
    return [initialSession()];
  }
}

/**
 * Persiste sesiones en localStorage (best-effort).
 */
function saveSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore quota/perm errors
  }
}

/**
 * Garantiza que exista exactamente una sesión activa.
 * Si ninguna está activa, activa la última (más reciente).
 */
function ensureOneActive(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  if (!list.some((s) => s.active)) {
    list[list.length - 1].active = true;
  }
  // Si hubiera múltiples activas por accidente, deja solo la más reciente
  const actives = list.filter((s) => s.active);
  if (actives.length > 1) {
    // dejar activa solo la de updatedAt más reciente
    const newest = actives.reduce((a, b) =>
      (a.updatedAt || 0) > (b.updatedAt || 0) ? a : b
    );
    for (const s of list) s.active = s.id === newest.id;
  }
}

/**
 * Hook principal para gestionar sesiones de chat en el cliente:
 * - Almacena todo en localStorage
 * - Soporta crear, renombrar, borrar, seleccionar, limpiar y actualizar mensajes
 */
export default function useChatSessions() {
  const [sessions, setSessions] = useState(() => loadSessions());

  // Sesión activa (siempre existe al menos una)
  const activeSession = useMemo(
    () => sessions.find((s) => s.active) || sessions[0],
    [sessions]
  );

  // Persistencia automática
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  /**
   * Activa una sesión por id (si no existe, no cambia nada).
   */
  const setActiveById = useCallback((id) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === id);
      if (!exists) return prev;
      const next = prev.map((s) => ({ ...s, active: s.id === id }));
      return next;
    });
  }, []);

  /**
   * Crea una nueva sesión y la deja activa.
   */
  const newSession = useCallback(() => {
    setSessions((prev) =>
      prev.map((s) => ({ ...s, active: false })).concat(initialSession())
    );
  }, []);

  /**
   * Elimina una sesión por id. Siempre mantiene al menos una.
   * Si borra la activa, activa la más reciente restante.
   */
  const deleteSession = useCallback((id) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) return [initialSession()];
      ensureOneActive(filtered);
      return filtered;
    });
  }, []);

  /**
   * Renombra una sesión (y actualiza updatedAt).
   */
  const renameSession = useCallback((id, title) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              title: String(title || "Untitled"),
              updatedAt: Date.now(),
            }
          : s
      )
    );
  }, []);

  // Mensajes de la sesión activa
  const messages = activeSession?.messages || [];

  /**
   * Agrega un mensaje a la sesión activa.
   * Si es el primer mensaje del usuario, auto-titula la conversación con un snippet.
   */
  const appendMessage = useCallback((msg) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (!s.active) return s;
        const messages = [
          ...s.messages,
          { ...msg, id: msg.id || uuid(), timestamp: Date.now() },
        ];
        let title = s.title;

        // Auto-título con el primer mensaje del usuario
        const userMsgs = messages.filter((m) => !m.isBot);
        if (
          userMsgs.length === 1 &&
          (title === "Nueva conversación" || !title?.trim())
        ) {
          title = userMsgs[0].content.slice(0, 40);
        }
        return { ...s, messages, title, updatedAt: Date.now() };
      })
    );
  }, []);

  /**
   * Actualiza un mensaje por id dentro de la sesión activa.
   */
  const updateMessage = useCallback((id, patch) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (!s.active) return s;
        const messages = s.messages.map((m) =>
          m.id === id ? { ...m, ...patch } : m
        );
        return { ...s, messages, updatedAt: Date.now() };
      })
    );
  }, []);

  /**
   * Limpia los mensajes de la sesión activa, dejando solo el saludo.
   */
  const clearActive = useCallback(() => {
    setSessions((prev) =>
      prev.map((s) =>
        s.active ? { ...s, messages: [GREETING()], updatedAt: Date.now() } : s
      )
    );
  }, []);

  /**
   * Resumen para la barra lateral (ordenado por “más reciente”).
   */
  const chatHistory = useMemo(
    () =>
      sessions
        .map((s) => ({
          id: s.id,
          title: s.title,
          timestamp: new Date(s.updatedAt || s.createdAt || Date.now()),
          active: !!s.active,
        }))
        .sort((a, b) => b.timestamp - a.timestamp),
    [sessions]
  );

  return {
    // estado crudo (por si se necesita)
    sessions,

    // derivado para la UI
    chatHistory,
    activeSession,
    messages,

    // acciones
    newSession,
    setActiveById,
    deleteSession,
    renameSession,
    appendMessage,
    updateMessage,
    clearActive,
  };
}