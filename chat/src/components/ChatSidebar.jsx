"use client"

import { MessageSquare, Clock, MoreHorizontal } from "lucide-react"
import { Button } from "../ui/button"

// Props extra (opcionales):
// - onSelect(id: string): seleccionar conversación
// - onRename(id: string, title: string): renombrar
// - onDelete(id: string): eliminar
export default function ChatSidebar({
  chatHistory,
  onSelect = () => {},
  onRename = () => {},
  onDelete = () => {},
}) {
  const fmtDate = (ts) => {
    try {
      const d = ts instanceof Date ? ts : new Date(ts)
      return d.toLocaleDateString()
    } catch {
      return ""
    }
  }

  const handleRowClick = (id) => {
    onSelect?.(id)
  }

  const handleMore = (e, chat) => {
    e.stopPropagation()
    // Menú mínimo sin cambiar UI: prompt/confirm nativos
    const action = window.prompt('Type an action: "rename" or "delete"', "rename")
    if (!action) return

    if (action.toLowerCase() === "rename") {
      const title = window.prompt("New title:", chat.title || "")
      if (title && title.trim()) onRename?.(chat.id, title.trim())
    } else if (action.toLowerCase() === "delete") {
      if (window.confirm("Delete this conversation? This cannot be undone.")) {
        onDelete?.(chat.id)
      }
    }
  }

  return (
    <div className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col">
      <div className="p-4 border-b border-slate-700">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Historial de Chats
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {chatHistory.map((chat) => (
          <div
            key={chat.id}
            onClick={() => handleRowClick(chat.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleRowClick(chat.id)
            }}
            role="button"
            tabIndex={0}
            aria-current={chat.active ? "true" : undefined}
            className={`group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
              chat.active ? "bg-blue-900 border border-blue-600" : "hover:bg-slate-700"
            }`}
            title={chat.title}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                chat.active ? "bg-blue-600 text-white" : "bg-slate-600 text-slate-300"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${chat.active ? "text-white" : "text-slate-200"}`}>
                {chat.title}
              </p>
              <p className="text-xs text-slate-400">{fmtDate(chat.timestamp)}</p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => handleMore(e, chat)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 h-auto text-slate-400 hover:text-white hover:bg-slate-600"
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-700">
        <p className="text-xs text-slate-400 text-center">Sofig's Chat v1.0</p>
      </div>
    </div>
  )
}