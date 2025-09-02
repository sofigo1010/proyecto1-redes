"use client"

import { useState } from "react"
import { Button } from "../ui/button"
import { Send } from "lucide-react"

/**
 * Props:
 * - onSendMessage: (text:string) => Promise<void> | void
 * - isSending: boolean  // deshabilita textarea y botón mientras streamea
 */
export default function ChatInput({ onSendMessage, isSending = false }) {
  const [input, setInput] = useState("")
  const [isComposing, setIsComposing] = useState(false) // evita Enter durante IME

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isSending || isComposing) return

    const value = input.trim()
    if (!value) return

    try {
      // si onSendMessage es async, espera a que termine
      await Promise.resolve(onSendMessage?.(value))
      // limpia solo si no hubo error
      setInput("")
    } catch {
      // si falla, conserva el texto para que el usuario pueda reintentar/editar
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault()
      // delega al submit (honra isSending)
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
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder="Escribe tu mensaje aquí..."
            className="w-full resize-none rounded-xl border border-slate-600 bg-slate-700 text-white placeholder-slate-400 px-4 py-3 pr-12 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm disabled:opacity-60"
            rows={1}
            style={{ minHeight: "44px", maxHeight: "120px" }}
            disabled={isSending}
            aria-disabled={isSending}
            aria-busy={isSending}
          />
        </div>
        <Button
          type="submit"
          disabled={isSending || !input.trim() || isComposing}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  )
}