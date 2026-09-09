'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, Sparkles, Square } from 'lucide-react'
import type {
  ClarificationOption,
  ConfirmationProposal,
  GameplayBlueprint,
  PlayableTaskPhase,
  RequirementBrief,
  RequirementInputRequest,
  VideoAnalysisStatus,
} from '@/lib/playable/schemas'
import type { PlayableAssetSlot } from '@/lib/playable/asset-policy'
import {
  isPlayableResourceAssetSlot,
  MAX_ASSETS_PER_SLOT,
  MAX_TASK_ASSETS,
  playableAssetAccept,
} from '@/lib/playable/asset-policy'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ConfirmationTable } from './confirmation-table'

const stages = [
  ['plan', '方案'],
  ['generating', '生成中'],
  ['playable', '可试玩'],
] as const
const phaseNames: Record<PlayableTaskPhase, string> = {
  draft: '整理方案',
  awaiting_confirmation: '方案待确认',
  building: '生成试玩',
  validating: '检查试玩',
  reviewing: '试玩已生成',
  ready: '可试玩',
  needs_plugin: '需要新增 Plugin',
  failed: '本次生成失败',
  cancelled: '已取消',
}
const requirementToolLabels: Record<string, string> = {
  update_requirement_brief: '更新 Brief',
  inspect_uploaded_assets: '检查素材',
  list_playable_capabilities: '读取能力',
  validate_implementation_route: '验证路由',
  respond_to_user: '回复问题',
  ask_user: '请求补充',
  submit_confirmation: '提交方案',
}
const defaultResourceTreatments: Record<string, string> = {
  tileFaces: '使用内置默认牌面素材',
  backgroundBoard: '使用内置默认背景与棋盘',
  animationEffects: '使用内置默认动画与特效',
  audio: '使用内置默认音频',
  endCard: '使用内置默认结束卡',
}

interface ChatWorkspaceProps {
  taskId: string
  initialPrompt?: string
  phase: PlayableTaskPhase
  proposal?: ConfirmationProposal
  brief?: RequirementBrief
  onProposal: (proposal?: ConfirmationProposal) => void
  onBrief?: (brief: RequirementBrief) => void
  onPhase: (phase: PlayableTaskPhase) => void
  onRequireApiKey: () => void
  autoSubmitInitialPrompt?: boolean
  initialConversation?: ConversationMessage[]
  initialAssets?: SafePlayableAsset[]
  videoAnalysisStatus?: VideoAnalysisStatus
  gameplayBlueprint?: GameplayBlueprint
}

export interface ConversationMessage {
  id: string | number
  role: 'user' | 'assistant'
  content: string
  status: 'sending' | 'streaming' | 'sent' | 'failed'
  reasoning?: string
  options?: ClarificationOption[]
  request?: RequirementInputRequest
}

function DynamicRequestActions({
  request,
  disabled,
  onSubmit,
}: {
  request: RequirementInputRequest
  disabled: boolean
  onSubmit: (value: string) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  if (!['single_select', 'multi_select', 'approval'].includes(request.type)) return null

  if (request.type !== 'multi_select') {
    return (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {request.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="outline"
            className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
            disabled={disabled}
            onClick={() => onSubmit(option.value)}
          >
            <span>
              <span className="block font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-xs font-normal">{option.description}</span>
            </span>
          </Button>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      {request.options.map((option) => {
        const checked = selected.includes(option.value)
        return (
          <label key={option.id} className="bg-background flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) =>
                setSelected((values) =>
                  next ? [...values, option.value] : values.filter((value) => value !== option.value),
                )
              }
            />
            <span>
              <span className="block font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-xs">{option.description}</span>
            </span>
          </label>
        )
      })}
      <Button
        type="button"
        size="sm"
        disabled={disabled || selected.length === 0}
        onClick={() => onSubmit(selected.join('；'))}
      >
        <Check aria-hidden="true" />
        确认选择
      </Button>
    </div>
  )
}

export function ChatWorkspace({
  taskId,
  initialPrompt = '',
  phase,
  proposal,
  brief,
  onProposal,
  onBrief,
  onPhase,
  onRequireApiKey,
  autoSubmitInitialPrompt = false,
  initialConversation = [],
  initialAssets = [],
  videoAnalysisStatus,
  gameplayBlueprint,
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
  const [removingAssetId, setRemovingAssetId] = useState<string>()
  const [selectedAssets, setSelectedAssets] = useState<SafePlayableAsset[]>(initialAssets)
  const [completedTools, setCompletedTools] = useState<string[]>([])
  const [error, setError] = useState('')
  const streamController = useRef<AbortController | undefined>(undefined)
  const scrollContainer = useRef<HTMLDivElement>(null)
  const autoSubmitted = useRef(false)
  const videoAnalysisInProgress =
    videoAnalysisStatus !== undefined && ['pending', 'preprocessing', 'analyzing'].includes(videoAnalysisStatus)
  const canCompose = ['draft', 'awaiting_confirmation', 'ready', 'failed'].includes(phase) && !videoAnalysisInProgress
  const currentStage =
    phase === 'building' || phase === 'validating' || phase === 'failed'
      ? 'generating'
      : phase === 'reviewing' || phase === 'ready'
        ? 'playable'
        : 'plan'

  useEffect(() => {
    if (!sending || !scrollContainer.current) return
    scrollContainer.current.scrollTop = scrollContainer.current.scrollHeight
  }, [conversation, sending])

  const sendMessage = useCallback(
    async (contentOverride?: string, appendToConversation = true) => {
      const content = (contentOverride ?? message).trim()
      if (!content || sending || !canCompose) return
      const id = Date.now()
      const assistantId = `assistant-${id}`
      const controller = new AbortController()
      streamController.current = controller
      setSending(true)
      setCompletedTools([])
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
        if (appendToConversation) {
          setConversation((items) => items.map((item) => (item.id === id ? { ...item, status: 'sent' } : item)))
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const updateAssistant = (next: Partial<ConversationMessage>) => {
          setConversation((items) => {
            const existing = items.find((item) => item.id === assistantId)
            if (!existing) {
              return [
                ...items,
                {
                  id: assistantId,
                  role: 'assistant',
                  content: next.content ?? '',
                  status: next.status ?? 'streaming',
                  reasoning: next.reasoning,
                  options: next.options,
                  request: next.request,
                },
              ]
            }
            return items.map((item) => (item.id === assistantId ? { ...item, ...next } : item))
          })
        }
        const handleLine = (line: string) => {
          if (!line.trim()) return
          let event: {
            type: string
            confirmation?: ConfirmationProposal
            message?: string
            reasoning?: string
            options?: ClarificationOption[]
            request?: RequirementInputRequest
            brief?: RequirementBrief
            tools?: string[]
            tool?: string
          }
          try {
            event = JSON.parse(line)
          } catch {
            throw new Error('响应数据格式错误，请重试')
          }
          if (event.type === 'assistant_progress') {
            updateAssistant({
              ...(event.message !== undefined ? { content: event.message } : {}),
              ...(event.reasoning !== undefined ? { reasoning: event.reasoning } : {}),
              status: 'streaming',
            })
          } else if (event.type === 'tool_completed' && event.tool) {
            setCompletedTools((items) => (items.includes(event.tool!) ? items : [...items, event.tool!]))
          } else if (event.type === 'informational' && event.message) {
            if (event.brief) onBrief?.(event.brief)
            updateAssistant({ content: event.message, reasoning: event.reasoning, status: 'sent' })
          } else if (event.type === 'confirmation' && event.confirmation) {
            if (event.brief) onBrief?.(event.brief)
            onProposal(event.confirmation)
            onPhase('awaiting_confirmation')
            if (event.message) {
              updateAssistant({ content: event.message, reasoning: event.reasoning, status: 'sent' })
            }
          } else if (event.type === 'clarification' && event.message) {
            if (event.brief) onBrief?.(event.brief)
            onProposal(undefined)
            onPhase('draft')
            updateAssistant({
              content: event.message,
              reasoning: event.reasoning,
              options: event.options,
              request: event.request,
              status: 'sent',
            })
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
        setMessage('')
      } catch (cause) {
        if (controller.signal.aborted) setError('已停止生成确认方案')
        else setError(cause instanceof Error ? cause.message : '请求失败，请稍后重试')
        setConversation((items) =>
          items.map((item) => (item.id === assistantId ? { ...item, status: 'failed' } : item)),
        )
      } finally {
        if (streamController.current === controller) streamController.current = undefined
        setSending(false)
      }
    },
    [canCompose, message, onBrief, onPhase, onProposal, onRequireApiKey, sending, taskId],
  )

  useEffect(() => {
    if (!autoSubmitInitialPrompt || !initialPrompt || phase !== 'draft' || autoSubmitted.current) return
    autoSubmitted.current = true
    void sendMessage(initialPrompt, false)
  }, [autoSubmitInitialPrompt, initialPrompt, phase, sendMessage])

  async function upload(slot: PlayableAssetSlot, files: File[]) {
    if (!proposal || phase !== 'awaiting_confirmation') return
    const slotCapacity = MAX_ASSETS_PER_SLOT - selectedAssets.filter((asset) => asset.slot === slot).length
    const taskCapacity = MAX_TASK_ASSETS - selectedAssets.length
    const acceptedFiles = files.slice(0, Math.max(0, Math.min(slotCapacity, taskCapacity)))
    if (acceptedFiles.length === 0) {
      setError('已达到素材上传数量上限')
      return
    }
    setUploadingSlot(slot)
    setError(acceptedFiles.length < files.length ? '部分素材超出数量上限，已自动忽略' : '')
    const uploaded: SafePlayableAsset[] = []
    try {
      for (const file of acceptedFiles) {
        if (!playableAssetAccept(slot).split(',').includes(file.type)) throw new Error('素材格式不受支持')
        const body = new FormData()
        body.set('slot', slot)
        body.set('file', file)
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/assets`, {
          method: 'POST',
          body,
        })
        if (!response.ok) throw new Error('素材上传失败')
        const result = (await response.json()) as { asset: SafePlayableAsset }
        uploaded.push(result.asset)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材上传失败')
    } finally {
      if (uploaded.length > 0) {
        setSelectedAssets((items) => [...items, ...uploaded])
        if (isPlayableResourceAssetSlot(slot)) {
          const slotAssets = [...selectedAssets, ...uploaded].filter((asset) => asset.slot === slot)
          onProposal({
            ...proposal,
            resources: {
              ...proposal.resources,
              [slot]: { status: '用户上传', treatment: slotAssets.map((asset) => asset.filename).join('、') },
            },
          })
        }
      }
      setUploadingSlot(undefined)
    }
  }

  async function removeAsset(asset: SafePlayableAsset) {
    if (!proposal || phase !== 'awaiting_confirmation' || removingAssetId) return
    setRemovingAssetId(asset.id)
    setError('')
    try {
      const response = await fetch(
        `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(asset.id)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw new Error('删除素材失败')
      const remaining = selectedAssets.filter((candidate) => candidate.id !== asset.id)
      setSelectedAssets(remaining)
      if (isPlayableResourceAssetSlot(asset.slot)) {
        const slotAssets = remaining.filter((candidate) => candidate.slot === asset.slot)
        onProposal({
          ...proposal,
          resources: {
            ...proposal.resources,
            [asset.slot]:
              slotAssets.length > 0
                ? { status: '用户上传', treatment: slotAssets.map((candidate) => candidate.filename).join('、') }
                : { status: '内置默认', treatment: defaultResourceTreatments[asset.slot] },
          },
        })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除素材失败')
    } finally {
      setRemovingAssetId(undefined)
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
    <section aria-label="需求对话" className="flex min-h-0 flex-col overflow-hidden">
      <div ref={scrollContainer} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pt-5 pb-1">
        <section aria-label="构建进度" className="bg-muted/50 rounded-xl p-3">
          <ol className="grid grid-cols-3 gap-1">
            {stages.map(([id, label]) => (
              <li
                key={id}
                aria-current={currentStage === id ? 'step' : undefined}
                className={
                  currentStage === id
                    ? phase === 'failed'
                      ? 'text-destructive font-semibold'
                      : 'text-primary font-semibold'
                    : 'text-muted-foreground'
                }
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

        {videoAnalysisStatus && (
          <section aria-label="参考视频分析" className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">QDAI 视频玩法分析</h2>
              <Badge variant={videoAnalysisStatus === 'failed' ? 'destructive' : 'secondary'}>
                {videoAnalysisStatus === 'pending'
                  ? '等待分析'
                  : videoAnalysisStatus === 'preprocessing'
                    ? '提取关键画面'
                    : videoAnalysisStatus === 'analyzing'
                      ? '理解玩法'
                      : videoAnalysisStatus === 'succeeded'
                        ? '蓝图已生成'
                        : '分析失败'}
              </Badge>
            </div>
            {gameplayBlueprint ? (
              <>
                <p className="text-muted-foreground text-xs leading-5">{gameplayBlueprint.summary}</p>
                {gameplayBlueprint.uncertainties.length > 0 && (
                  <p className="text-xs">待确认：{gameplayBlueprint.uncertainties.join('、')}</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                {videoAnalysisStatus === 'failed'
                  ? '将继续使用文字需求，你也可以重新上传参考视频。'
                  : '正在把参考视频转换为可供玩法 Agent 使用的结构化蓝图。'}
              </p>
            )}
          </section>
        )}

        {brief && (
          <section aria-label="需求 Brief" className="space-y-2 border-b pb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">实时 Brief</h2>
              <Badge variant="outline">
                {brief.routing.match === 'undecided'
                  ? '尚未评估'
                  : brief.routing.match === 'exact'
                    ? '模板匹配'
                    : brief.routing.match === 'approximate'
                      ? '部分匹配'
                      : '自由生成'}
              </Badge>
            </div>
            <p className="text-muted-foreground line-clamp-3 text-xs leading-5">
              {brief.summary || '正在整理游戏想法'}
            </p>
            {brief.openQuestions.length > 0 && <p className="text-xs">待确认：{brief.openQuestions.join('、')}</p>}
            {completedTools.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="本轮 Agent 工具">
                {completedTools.map((tool) => (
                  <Badge key={tool} variant="secondary" className="text-[10px] font-normal">
                    {requirementToolLabels[tool] ?? '业务工具'}
                  </Badge>
                ))}
              </div>
            )}
          </section>
        )}

        {conversation.map((item) =>
          item.role === 'user' ? (
            <div
              key={item.id}
              className="bg-primary text-primary-foreground ml-auto w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-3 text-sm"
            >
              {item.content}
              {item.status !== 'sent' && (
                <span className="mt-1 block text-xs opacity-75">
                  {item.status === 'sending' ? '发送中…' : '发送失败'}
                </span>
              )}
            </div>
          ) : (
            <article key={item.id} className="flex min-w-0 items-start gap-3" aria-label="助手回复">
              <span className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
                {item.status === 'streaming' ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1 pt-1 text-sm leading-6">
                {item.reasoning && (
                  <details className="text-muted-foreground mb-2 text-xs">
                    <summary className="cursor-pointer select-none">Thinking</summary>
                    <p className="mt-1 border-l pl-3 leading-5">{item.reasoning}</p>
                  </details>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {item.content || (item.status === 'streaming' ? 'Loading…' : '')}
                  {item.status === 'streaming' && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
                </div>
                {item.request && item.request.question !== item.content && (
                  <p className="mt-2 text-xs font-medium">{item.request.question}</p>
                )}
                <DynamicRequestActions
                  request={
                    item.request ?? {
                      type: 'single_select',
                      question: item.content,
                      options: item.options ?? [],
                      allowCustom: true,
                    }
                  }
                  disabled={sending || !canCompose}
                  onSubmit={(value) => void sendMessage(value)}
                />
                {item.status === 'failed' && <span className="text-destructive mt-1 block text-xs">回复已中断</span>}
              </div>
            </article>
          ),
        )}

        <div className="sr-only" aria-live="polite">
          {selectedAssets.length ? `已选择素材：${selectedAssets.at(-1)?.filename}` : ''}
        </div>

        {sending && !conversation.some((item) => item.status === 'streaming') && (
          <section aria-label="Thinking" className="flex items-center gap-3">
            <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
              <Sparkles className="size-3.5" aria-hidden="true" />
            </span>
            <div className="flex items-center gap-1 text-sm font-medium">
              <span>Thinking</span>
              <span className="flex items-center gap-1" aria-hidden="true">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="bg-muted-foreground size-1 animate-bounce rounded-full"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            </div>
          </section>
        )}

        {proposal && (
          <ConfirmationTable
            proposal={proposal}
            onChange={onProposal}
            onConfirm={confirm}
            confirming={confirming}
            buildPhase={phase === 'building' || phase === 'validating' ? phase : undefined}
            disabled={phase !== 'awaiting_confirmation'}
            uploadingSlot={uploadingSlot}
            onUpload={upload}
            onRemoveAsset={removeAsset}
            uploadedAssets={selectedAssets}
            removingAssetId={removingAssetId}
            assetPreviewUrl={(asset) =>
              `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(asset.id)}`
            }
          />
        )}

        {(phase === 'needs_plugin' || phase === 'cancelled') && (
          <Button asChild variant="outline" className="w-full">
            <Link href="/">新建试玩</Link>
          </Button>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="h-4 shrink-0" aria-hidden="true" />
      </div>

      <div className="bg-background shrink-0 border-t p-4">
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
