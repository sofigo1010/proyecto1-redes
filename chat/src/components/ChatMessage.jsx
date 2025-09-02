"use client"

import { Bot, User } from "lucide-react"
import Markdown from "../ui/Markdown"

function formatTime(ts) {
  try {
    if (!ts) return ""
    const d = ts instanceof Date ? ts : new Date(ts)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

export default function ChatMessage({ message }) {
  const { content = "", isBot, timestamp } = message
  const time = formatTime(timestamp)

  return (
    <div className={`flex gap-3 ${isBot ? "justify-start" : "justify-end"}`}>
      {isBot && (
        <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}

      <div className={`max-w-[70%] ${isBot ? "order-2" : "order-1"}`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isBot ? "bg-slate-700 border border-slate-600 text-white" : "bg-blue-600 text-white"
          }`}
        >
          {isBot ? (
            <div className="text-sm leading-relaxed">
              <Markdown>{String(content)}</Markdown>
            </div>
          ) : (
            <p className="text-sm leading-relaxed">{String(content)}</p>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1 px-2">{time}</p>
      </div>

      {!isBot && (
        <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0 order-2">
          <User className="w-4 h-4 text-white" />
        </div>
      )}
    </div>
  )
}