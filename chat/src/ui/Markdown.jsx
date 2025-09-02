"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function Markdown({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-90" />
        ),
        p: (p) => <p className="mb-2" {...p} />,
        ul: (p) => <ul className="list-disc ml-5 space-y-1" {...p} />,
        ol: (p) => <ol className="list-decimal ml-5 space-y-1" {...p} />,
        code: ({ inline, children, ...props }) =>
          inline ? (
            <code className="px-1 py-0.5 rounded bg-slate-800/60 border border-slate-700">{children}</code>
          ) : (
            <pre className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 overflow-x-auto">
              <code {...props}>{children}</code>
            </pre>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}