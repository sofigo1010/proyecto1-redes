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
    appendMessage,
    updateMessage,
    clearActive,
  } = useChatSessions()

  // ID incremental local (solo para placeholders rápidos, pero se guardan en hook de sesiones)
  const idRef = useRef(1)
  const nextId = () => ++idRef.current

  const handleNewChat = useCallback(() => {
    newSession()
  }, [newSession])

  const handleSelectChat = useCallback((id) => {
    setActiveById(id)
  }, [setActiveById])

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

    // 3) construir historial para Claude (rol user/assistant)
    //    Excluimos el placeholder del bot
    const base = messages.concat([{ id: userMsgId, content: trimmed, isBot: false }])
    const toClaude = base.map(m => ({
      role: m.isBot ? 'assistant' : 'user',
      content: m.content,
    }))

    try {
      await sendMessage(trimmed, {
        messages: toClaude, // ← historial completo
        onDelta: (_chunk, full) => {
          updateMessage(botMsgId, { content: full })
        },
      })
    } catch (e) {
      updateMessage(botMsgId, { content: `⚠️ ${e?.message || 'Error procesando tu mensaje.'}` })
    }
  }, [messages, isSending, appendMessage, updateMessage, sendMessage])

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Sidebar: historial persistente */}
      <ChatSidebar
        chatHistory={chatHistory}
        onSelect={handleSelectChat}        // si tu Sidebar todavía no usa, puedes ignorarlo
        onNewChat={handleNewChat}          // idem
      />

      {/* Área principal del chat */}
      <div className="flex-1 flex flex-col">
        <ChatHeader onNewChat={handleNewChat} />

        <ChatArea messages={messages} />

        <ChatInput onSendMessage={handleSend} isSending={isSending} />
      </div>
    </div>
  )
}