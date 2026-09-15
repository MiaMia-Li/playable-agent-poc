'use client'

import { Streamdown } from 'streamdown'

function isWebLink(href: string | undefined): boolean {
  if (!href || !/^https?:\/\//i.test(href)) return false
  try {
    const url = new URL(href)
    return Boolean(url.hostname)
  } catch {
    return false
  }
}

function internalFilename(href: string | undefined): string | undefined {
  if (!href || href.startsWith('#')) return
  // Keep non-file protocols inert too, but retain their visible label.
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:file:|sandbox:|[a-z]:[\\/])/i.test(href)) return
  const filename = href.split(/[?#]/, 1)[0].replace(/\\/g, '/').split('/').filter(Boolean).at(-1)
  if (!filename) return
  try {
    return decodeURIComponent(filename)
  } catch {
    return filename
  }
}

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
        a: ({ href, children }) =>
          isWebLink(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {children}
            </a>
          ) : (
            <code className="bg-muted rounded px-1 text-xs">{internalFilename(href) ?? children}</code>
          ),
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
