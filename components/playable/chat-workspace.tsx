'use client'

import { useRef, useState } from 'react'
import { ArrowUp, Paperclip, Sparkles } from 'lucide-react'
import type { ConfirmationProposal, PlayableTaskPhase } from '@/lib/playable/schemas'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmationTable } from './confirmation-table'

const phaseLabels = '需求整理 → 等待确认 → 构建中 → 验证中 → 可预览'

interface ChatWorkspaceProps {
  taskId: string
  initialPrompt?: string
  phase: PlayableTaskPhase
  proposal?: ConfirmationProposal
  onProposal: (proposal: ConfirmationProposal) => void
  onPhase: (phase: PlayableTaskPhase) => void
  onRequireApiKey: () => void
}

export function ChatWorkspace({
  taskId,
  initialPrompt = '',
  phase,
  proposal,
  onProposal,
  onPhase,
  onRequireApiKey,
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState(initialPrompt)
  const [conversation, setConversation] = useState<string[]>(initialPrompt ? [initialPrompt] : [])
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  async function sendMessage() {
    const content = message.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    if (!conversation.includes(content)) setConversation((items) => [...items, content])
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      })
      if (response.status === 428) {
        onRequireApiKey()
        return
      }
      if (!response.ok || !response.body) throw new Error('无法生成确认方案')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line) continue
          const event = JSON.parse(line) as {
            type: string
            confirmation?: ConfirmationProposal
            message?: string
          }
          if (event.type === 'confirmation' && event.confirmation) {
            onProposal(event.confirmation)
            onPhase('awaiting_confirmation')
          } else if (event.type === 'error') {
            throw new Error(event.message || '无法生成确认方案')
          }
        }
        if (done) break
      }
      setMessage('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请求失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  async function confirm() {
    if (!proposal || confirming) return
    setConfirming(true)
    setError('')
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: proposal }),
      })
      if (response.status === 428) {
        onRequireApiKey()
        return
      }
      if (!response.ok) throw new Error('无法开始构建')
      onPhase('building')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法开始构建')
    } finally {
      setConfirming(false)
    }
  }

  function upload(files: FileList | null) {
    if (!files?.length) return
    setUploadedFiles((items) => [...items, ...Array.from(files, (file) => file.name)])
    if (proposal) {
      const resources = { ...proposal.resources }
      for (const key of Object.keys(resources) as Array<keyof typeof resources>) {
        if (resources[key].status === '待上传') resources[key] = { ...resources[key], status: '用户上传' }
      }
      onProposal({ ...proposal, resources })
    }
  }

  return (
    <section aria-label="需求对话" className="flex min-h-0 flex-col">
      <header className="border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-semibold">试玩创作助手</h1>
            <p className="text-muted-foreground text-xs">描述创意，确认方案，然后获取可交互试玩</p>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section aria-label="构建进度" className="bg-muted/50 rounded-xl p-3">
          <p className="text-muted-foreground text-xs font-medium">{phaseLabels}</p>
          <p className="mt-1 text-sm" aria-live="polite">
            当前状态：{phase}
          </p>
        </section>

        {conversation.map((content, index) => (
          <div
            key={`${content}-${index}`}
            className="bg-primary text-primary-foreground ml-auto max-w-[88%] rounded-2xl rounded-br-sm px-4 py-3 text-sm"
          >
            {content}
          </div>
        ))}

        {uploadedFiles.length > 0 && (
          <div className="bg-muted rounded-xl px-3 py-2 text-sm">已选择素材：{uploadedFiles.join('、')}</div>
        )}

        {proposal && (
          <ConfirmationTable proposal={proposal} onChange={onProposal} onConfirm={confirm} confirming={confirming} />
        )}

        {!proposal && (
          <section aria-label="确认方案" className="border-muted-foreground/20 rounded-xl border border-dashed p-4">
            <p className="text-muted-foreground text-sm">发送需求后，这里会显示完整的玩法、素材、文案与交付确认表。</p>
          </section>
        )}

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="bg-background border-t p-4">
        <div className="focus-within:ring-ring/40 rounded-2xl border p-2 shadow-sm focus-within:ring-2">
          <Textarea
            aria-label="试玩需求"
            placeholder="描述你想制作的试玩，例如玩法、视觉风格、商店链接…"
            className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />
          <div className="flex items-center justify-between">
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              multiple
              accept="image/*,audio/*,video/*"
              onChange={(event) => upload(event.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="上传素材"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip aria-hidden="true" />
              上传素材
            </Button>
            <Button
              type="button"
              size="icon"
              aria-label="发送需求"
              disabled={!message.trim() || sending}
              onClick={() => void sendMessage()}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
