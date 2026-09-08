'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Sparkles, Square } from 'lucide-react'
import type { ClarificationOption, ConfirmationProposal, PlayableTaskPhase } from '@/lib/playable/schemas'
import type { PlayableAssetSlot } from '@/lib/playable/task-assets'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmationTable } from './confirmation-table'

const stages = [
  ['draft', '需求整理'],
  ['awaiting_confirmation', '等待确认'],
  ['building', '构建中'],
  ['validating', '验证中'],
  ['reviewing', '待验收'],
  ['ready', '已交付'],
] as const
const phaseNames: Record<PlayableTaskPhase, string> = {
  draft: '需求整理',
  awaiting_confirmation: '等待确认',
  building: '构建中',
  validating: '验证中',
  reviewing: '等待人工验收',
  ready: '已验收，可交付',
  needs_plugin: '需要新增 Plugin',
  failed: '构建失败',
  cancelled: '已取消',
}

interface ChatWorkspaceProps {
  taskId: string
  initialPrompt?: string
  phase: PlayableTaskPhase
  proposal?: ConfirmationProposal
  onProposal: (proposal?: ConfirmationProposal) => void
  onPhase: (phase: PlayableTaskPhase) => void
  onRequireApiKey: () => void
  autoSubmitInitialPrompt?: boolean
  initialConversation?: ConversationMessage[]
}

export interface ConversationMessage {
  id: string | number
  role: 'user' | 'assistant'
  content: string
  status: 'sending' | 'sent' | 'failed'
  reasoning?: string
  options?: ClarificationOption[]
}

export function ChatWorkspace({
  taskId,
  initialPrompt = '',
  phase,
  proposal,
  onProposal,
  onPhase,
  onRequireApiKey,
  autoSubmitInitialPrompt = false,
  initialConversation = [],
}: ChatWorkspaceProps) {
  const [message, setMessage] = useState('')
  const [conversation, setConversation] = useState<ConversationMessage[]>(
    initialConversation.length
      ? initialConversation
      : initialPrompt
        ? [{ id: 0, role: 'user', content: initialPrompt, status: 'sent' }]
        : [],
  )
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<PlayableAssetSlot>()
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [error, setError] = useState('')
  const streamController = useRef<AbortController | undefined>(undefined)
  const autoSubmitted = useRef(false)
  const canCompose = phase === 'draft' || phase === 'awaiting_confirmation'

  const sendMessage = useCallback(
    async (contentOverride?: string, appendToConversation = true) => {
      const content = (contentOverride ?? message).trim()
      if (!content || sending || !canCompose) return
      const id = Date.now()
      const controller = new AbortController()
      streamController.current = controller
      setSending(true)
      setError('')
      if (appendToConversation) setConversation((items) => [...items, { id, role: 'user', content, status: 'sending' }])
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content }),
          signal: controller.signal,
        })
        if (response.status === 428) {
          onRequireApiKey()
          throw new Error('请先配置 API Key')
        }
        if (response.status === 409) throw new Error('当前阶段不接受新需求，请新建试玩后继续')
        if (!response.ok || !response.body) throw new Error('无法生成确认方案')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const handleLine = (line: string) => {
          if (!line.trim()) return
          let event: {
            type: string
            confirmation?: ConfirmationProposal
            message?: string
            reasoning?: string
            options?: ClarificationOption[]
          }
          try {
            event = JSON.parse(line)
          } catch {
            throw new Error('响应数据格式错误，请重试')
          }
          if (event.type === 'confirmation' && event.confirmation) {
            onProposal(event.confirmation)
            onPhase('awaiting_confirmation')
            if (event.message) {
              setConversation((items) => [
                ...items,
                {
                  id: Date.now() + 1,
                  role: 'assistant',
                  content: event.message!,
                  reasoning: event.reasoning,
                  status: 'sent',
                },
              ])
            }
          } else if (event.type === 'clarification' && event.message) {
            onProposal(undefined)
            onPhase('draft')
            setConversation((items) => [
              ...items,
              {
                id: Date.now() + 1,
                role: 'assistant',
                content: event.message!,
                reasoning: event.reasoning,
                options: event.options,
                status: 'sent',
              },
            ])
          } else if (event.type === 'plugin_request' && event.message) {
            onProposal(undefined)
            onPhase('needs_plugin')
            setConversation((items) => [
              ...items,
              {
                id: Date.now() + 1,
                role: 'assistant',
                content: event.message!,
                reasoning: event.reasoning,
                status: 'sent',
              },
            ])
          } else if (event.type === 'error') {
            throw new Error(event.message || '无法生成确认方案')
          }
        }
        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) handleLine(line)
          if (done) {
            handleLine(buffer)
            break
          }
        }
        if (appendToConversation) {
          setConversation((items) => items.map((item) => (item.id === id ? { ...item, status: 'sent' } : item)))
        }
        setMessage('')
      } catch (cause) {
        if (controller.signal.aborted) setError('已停止生成确认方案')
        else setError(cause instanceof Error ? cause.message : '请求失败，请稍后重试')
        if (appendToConversation) {
          setConversation((items) => items.map((item) => (item.id === id ? { ...item, status: 'failed' } : item)))
        }
      } finally {
        if (streamController.current === controller) streamController.current = undefined
        setSending(false)
      }
    },
    [canCompose, message, onPhase, onProposal, onRequireApiKey, sending, taskId],
  )

  useEffect(() => {
    if (!autoSubmitInitialPrompt || !initialPrompt || phase !== 'draft' || autoSubmitted.current) return
    autoSubmitted.current = true
    void sendMessage(initialPrompt, false)
  }, [autoSubmitInitialPrompt, initialPrompt, phase, sendMessage])

  async function upload(slot: PlayableAssetSlot, file: File) {
    if (!proposal || phase !== 'awaiting_confirmation') return
    setUploadingSlot(slot)
    setError('')
    const body = new FormData()
    body.set('slot', slot)
    body.set('file', file)
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/assets`, {
        method: 'POST',
        body,
      })
      if (!response.ok) throw new Error('素材上传失败')
      const result = (await response.json()) as { asset: { filename: string; slot: PlayableAssetSlot } }
      onProposal({
        ...proposal,
        resources: {
          ...proposal.resources,
          [result.asset.slot]: { status: '用户上传', treatment: result.asset.filename },
        },
      })
      setSelectedAssets((items) => [...items, `${phaseNames[phase]}：${result.asset.filename}`])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材上传失败')
    } finally {
      setUploadingSlot(undefined)
    }
  }

  async function confirm() {
    if (!proposal || confirming || phase !== 'awaiting_confirmation') return
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
        throw new Error('请先配置 API Key')
      }
      if (response.status === 409) throw new Error('方案状态已变化，请刷新后重试')
      if (!response.ok) throw new Error('无法开始构建')
      onPhase('building')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法开始构建')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <section aria-label="需求对话" className="flex max-h-[70dvh] min-h-[32rem] flex-col lg:max-h-none lg:min-h-0">
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
          <ol className="grid grid-cols-6 gap-1">
            {stages.map(([id, label]) => (
              <li
                key={id}
                aria-current={phase === id ? 'step' : undefined}
                className={phase === id ? 'text-primary font-semibold' : 'text-muted-foreground'}
              >
                <span className="mb-1 block h-1 rounded-full bg-current" />
                <span className="text-[10px] sm:text-xs">{label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm" aria-live="polite">
            当前状态：{phaseNames[phase]}
          </p>
        </section>

        {conversation.map((item) => (
          <div
            key={item.id}
            className={
              item.role === 'user'
                ? 'bg-primary text-primary-foreground ml-auto max-w-[88%] rounded-2xl rounded-br-sm px-4 py-3 text-sm'
                : 'bg-muted mr-auto max-w-[92%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm'
            }
          >
            {item.content}
            {item.reasoning && (
              <p className="text-muted-foreground mt-2 border-t pt-2 text-xs">判断依据：{item.reasoning}</p>
            )}
            {item.options?.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {item.options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                    disabled={sending || !canCompose}
                    onClick={() => void sendMessage(option.value)}
                  >
                    <span>
                      <span className="block font-medium">{option.label}</span>
                      <span className="text-muted-foreground block text-xs font-normal">{option.description}</span>
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {item.status !== 'sent' && (
              <span className="mt-1 block text-xs opacity-75">
                {item.status === 'sending' ? '发送中…' : '发送失败'}
              </span>
            )}
          </div>
        ))}

        <div className="sr-only" aria-live="polite">
          {selectedAssets.length ? `已选择素材：${selectedAssets.at(-1)}` : ''}
        </div>

        {sending && (
          <section
            aria-label="助手正在思考"
            className="border-muted-foreground/20 flex items-center gap-3 rounded-xl border border-dashed p-4"
          >
            <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">助手正在思考</p>
              <p className="text-muted-foreground mt-1 text-xs">正在结合对话、已选方案和素材状态整理下一步。</p>
            </div>
          </section>
        )}

        {proposal ? (
          <ConfirmationTable
            proposal={proposal}
            onChange={onProposal}
            onConfirm={confirm}
            confirming={confirming}
            buildPhase={phase === 'building' || phase === 'validating' ? phase : undefined}
            disabled={phase !== 'awaiting_confirmation'}
            uploadingSlot={uploadingSlot}
            onUpload={upload}
          />
        ) : !sending ? (
          <section aria-label="确认方案" className="border-muted-foreground/20 rounded-xl border border-dashed p-4">
            <p className="text-muted-foreground text-sm">发送需求后，这里会显示完整的玩法、素材、文案与交付确认表。</p>
          </section>
        ) : null}

        {(phase === 'ready' || phase === 'needs_plugin' || phase === 'failed' || phase === 'cancelled') && (
          <Button asChild variant="outline" className="w-full">
            <Link href="/">新建试玩</Link>
          </Button>
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
            placeholder={canCompose ? '描述你想制作的试玩…' : '当前阶段不可继续输入，请新建试玩'}
            className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0"
            value={message}
            disabled={!canCompose || sending}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="flex justify-end">
            {sending ? (
              <Button type="button" variant="destructive" size="sm" onClick={() => streamController.current?.abort()}>
                <Square aria-hidden="true" />
                停止生成
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                aria-label="发送需求"
                disabled={!message.trim() || !canCompose}
                onClick={() => void sendMessage()}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
