"use client"

import { useEffect, useRef } from "react"
import ChatMessage from "./ChatMessage"

function TypingBubble() {
  return (
    <div className="flex gap-3 justify-start">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
        <span className="w-2 h-2 bg-white/90 rounded-full animate-pulse" />
      </div>
      <div className="max-w-[70%]">
        <div className="rounded-2xl px-4 py-3 bg-slate-700 border border-slate-600 text-white">
          <p className="text-sm leading-relaxed opacity-80">Escribiendo…</p>
        </div>
      </div>
    </div>
  )
}

export default function ChatArea({ messages, isTyping = false }) {
  const endRef = useRef(null)
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, isTyping])

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-slate-900">
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
      {isTyping && <TypingBubble />}
      <div ref={endRef} />
    </div>
  )
}