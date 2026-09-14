'use client'

import { Streamdown } from 'streamdown'

/** 正文和思考摘要共用 Markdown 解析，原始 HTML 不参与渲染。 */
function AgentMarkdown({ children }: { children: string }) {
  return (
    <Streamdown
      mode="static"
      controls={false}
      rehypePlugins={[]}
      remarkRehypeOptions={{ allowDangerousHtml: false }}
      className="space-y-2 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_pre]:max-h-64 [&_pre]:overflow-auto"
      components={{
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        code: ({ children }) => <code className="bg-muted rounded px-1 text-xs">{children}</code>,
        pre: ({ children }) => <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap">{children}</pre>,
      }}
    >
      {children}
    </Streamdown>
  )
}

/** 思考摘要沿用灰色细线样式，正文继承对话字号。 */
export function ReasoningText({ children }: { children: string }) {
  return (
    <div className="mt-1 border-l pl-3 text-xs leading-5 break-words">
      <AgentMarkdown>{children}</AgentMarkdown>
    </div>
  )
}

export function AgentText({ children }: { children: string }) {
  return (
    <div className="text-sm leading-6 break-words">
      <AgentMarkdown>{children}</AgentMarkdown>
    </div>
  )
}
