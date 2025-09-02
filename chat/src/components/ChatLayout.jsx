"use client"

import { useCallback, useMemo, useRef } from "react"
import ChatHeader from "./ChatHeader"
import ChatArea from "./ChatArea"
import ChatSidebar from "./ChatSidebar"
import ChatInput from "./ChatInput"
import useChat from "../hooks/useChat"
import useChatSessions from "../hooks/useChatSessions"

export default function ChatLayout() {
  const { isSending, sendMessage, cancel, error } = useChat()
  const {
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
  } = useChatSessions()

  // ID incremental local (solo para placeholders rápidos)
  const idRef = useRef(1)
  const nextId = () => ++idRef.current

  const handleNewChat = useCallback(() => {
    newSession()
  }, [newSession])

  const handleSelectChat = useCallback((id) => {
    setActiveById(id)
  }, [setActiveById])

  const handleRenameChat = useCallback((id, title) => {
    renameSession(id, title)
  }, [renameSession])

  const handleDeleteChat = useCallback((id) => {
    // si se borra la sesión activa y está streameando, cancelam
    if (activeSession?.id === id && isSending) {
      try { cancel() } catch {}
    }
    deleteSession(id)
  }, [activeSession?.id, isSending, cancel, deleteSession])

  const handleSend = useCallback(async (text) => {
    const trimmed = String(text || "").trim()
    if (!trimmed || isSending) return

    // 1) push user
    const userMsgId = `u_${nextId()}`
    appendMessage({
      id: userMsgId,
      content: trimmed,
      isBot: false,
    })

    // 2) placeholder bot
    const botMsgId = `b_${nextId()}`
    appendMessage({
      id: botMsgId,
      content: "",
      isBot: true,
    })

    // 3) construir historial para Claude (rol user/assistant) excluyendo el placeholder
    const base = messages.concat([{ id: userMsgId, content: trimmed, isBot: false }])
    const toClaude = base.map(m => ({
      role: m.isBot ? "assistant" : "user",
      content: m.content,
    }))

    try {
      await sendMessage(trimmed, {
        messages: toClaude,
        onDelta: (_chunk, full) => {
          updateMessage(botMsgId, { content: full })
        },
      })
    } catch (e) {
      updateMessage(botMsgId, { content: `⚠️ ${e?.message || "Error procesando tu mensaje."}` })
    }
  }, [messages, isSending, appendMessage, updateMessage, sendMessage])

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Sidebar: historial persistente */}
      <ChatSidebar
        chatHistory={chatHistory}
        onSelect={handleSelectChat}
        onNewChat={handleNewChat}
        onRename={handleRenameChat}
        onDelete={handleDeleteChat}
      />

      {/* Área principal del chat */}
      <div className="flex-1 flex flex-col">
        <ChatHeader onNewChat={handleNewChat} />
        <ChatArea messages={messages} isTyping={isSending} />
        <ChatInput onSendMessage={handleSend} isSending={isSending} />
      </div>
    </div>
  )
}