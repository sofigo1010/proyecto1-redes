"use client"

import { useState } from "react"
import ChatHeader from "./ChatHeader"
import ChatArea from "./ChatArea"
import ChatSidebar from "./ChatSidebar"
import ChatInput from "./ChatInput"

export default function ChatLayout() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      content: "¡Hola! Soy Sofig's Chat. ¿En qué puedo ayudarte hoy?",
      isBot: true,
      timestamp: new Date(),
    },
  ])

  const [chatHistory, setChatHistory] = useState([
    { id: 1, title: "Nueva conversación", timestamp: new Date(), active: true },
  ])

  const handleSendMessage = (content) => {
    const newMessage = {
      id: messages.length + 1,
      content,
      isBot: false,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, newMessage])

    setTimeout(() => {
      const botResponse = {
        id: messages.length + 2,
        content: "Gracias por tu mensaje. Esta es una respuesta de ejemplo del chat.",
        isBot: true,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, botResponse])
    }, 1000)
  }

  const handleNewChat = () => {
    const newChat = {
      id: chatHistory.length + 1,
      title: `Chat ${chatHistory.length + 1}`,
      timestamp: new Date(),
      active: true,
    }

    setChatHistory((prev) => prev.map((chat) => ({ ...chat, active: false })).concat(newChat))
    setMessages([
      {
        id: 1,
        content: "¡Hola! Soy Sofig's Chat. ¿En qué puedo ayudarte hoy?",
        isBot: true,
        timestamp: new Date(),
      },
    ])
  }

  return (
    <div className="flex h-screen bg-slate-900">
      {/* Sidebar izquierdo */}
      <ChatSidebar chatHistory={chatHistory} />

      {/* Área principal del chat */}
      <div className="flex-1 flex flex-col">
        <ChatHeader onNewChat={handleNewChat} />
        <ChatArea messages={messages} />
        <ChatInput onSendMessage={handleSendMessage} />
      </div>
    </div>
  )
}
