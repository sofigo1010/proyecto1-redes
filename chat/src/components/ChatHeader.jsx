"use client"

import { Button } from "../ui/button"
import { Plus, MessageSquare } from "lucide-react"

export default function ChatHeader({ onNewChat }) {
  return (
    <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-semibold text-white">Sofig's Chat</h1>
      </div>

      <Button onClick={onNewChat} className="bg-blue-600 hover:bg-blue-500 text-white gap-2">
        <Plus className="w-4 h-4" />
        Nuevo Chat
      </Button>
    </header>
  )
}
