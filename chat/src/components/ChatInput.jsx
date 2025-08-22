"use client"

import { useState } from "react"
import { Button } from "../ui/button"
import { Send } from "lucide-react"

export default function ChatInput({ onSendMessage }) {
  const [input, setInput] = useState("")

  const handleSubmit = (e) => {
    e.preventDefault()
    if (input.trim()) {
      onSendMessage(input.trim())
      setInput("")
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="border-t border-slate-700 bg-slate-800 px-6 py-4">
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="flex-1 relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Escribe tu mensaje aquí..."
            className="w-full resize-none rounded-xl border border-slate-600 bg-slate-700 text-white placeholder-slate-400 px-4 py-3 pr-12 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
            rows={1}
            style={{ minHeight: "44px", maxHeight: "120px" }}
          />
        </div>
        <Button
          type="submit"
          disabled={!input.trim()}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  )
}
