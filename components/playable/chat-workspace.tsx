'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  CheckCircle2,
  Loader2,
  Paperclip,
  PencilLine,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import type {
  ClarificationOption,
  ConfirmationProposal,
  GameplayBlueprint,
  PlayableTaskPhase,
  RequirementBrief,
  RequirementInputRequest,
  RevisionPlan,
  RevisionProposal,
  VideoAnalysisStatus,
} from '@/lib/playable/schemas'
import type { PlayableAssetSlot } from '@/lib/playable/asset-policy'
import {
  isPlayableResourceAssetSlot,
  MAX_ASSETS_PER_SLOT,
  MAX_HOME_ATTACHMENTS,
  MAX_TASK_ASSETS,
  PLAYABLE_REFERENCE_ACCEPT,
  maxAssetBytesForSlot,
  playableAssetAccept,
  referenceSlotForMimeType,
} from '@/lib/playable/asset-policy'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ConfirmationTable, isConfirmationReady } from './confirmation-table'

const stages = [
  ['plan', '方案'],
  ['generating', '生成中'],
  ['playable', '可试玩'],
] as const
const phaseNames: Record<PlayableTaskPhase, string> = {
  draft: '整理方案',
  awaiting_confirmation: '方案待确认',
  awaiting_revision_confirmation: '修改待确认',
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
  submit_revision: '提交修改计划',
  inspect_reference_images: '分析参考图片',
  analyze_reference_video: '分析参考视频',
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
  revision?: RevisionProposal
  hasArtifact?: boolean
  brief?: RequirementBrief
  onProposal: (proposal?: ConfirmationProposal) => void
  onRevision?: (revision?: RevisionProposal) => void
  onBrief?: (brief: RequirementBrief) => void
  onPhase: (phase: PlayableTaskPhase) => void
  onRequireApiKey?: () => void
  autoSubmitInitialPrompt?: boolean
  initialConversation?: ConversationMessage[]
  initialAssets?: SafePlayableAsset[]
  videoAnalysisStatus?: VideoAnalysisStatus
  gameplayBlueprint?: GameplayBlueprint
  onAssetsChange?: (assets: SafePlayableAsset[]) => void
  onVideoAnalysisToolStatus?: (status: 'started' | 'completed' | 'failed') => void
}

interface ConversationAttachment {
  id: string
  filename: string
  mimeType: string
}

interface ComposerAttachment {
  id: string
  file: File
  filename: string
  mimeType: string
  status: 'staged' | 'uploading' | 'uploaded' | 'failed'
  asset?: SafePlayableAsset
}

export interface ConversationMessage {
  id: string | number
  role: 'user' | 'assistant'
  content: string
  status: 'sending' | 'streaming' | 'sent' | 'failed'
  reasoning?: string
  options?: ClarificationOption[]
  request?: RequirementInputRequest
  attachments?: ConversationAttachment[]
  confirmation?: ConfirmationProposal
  revision?: RevisionPlan | RevisionProposal
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

function RevisionSummary({ revision }: { revision: RevisionPlan | RevisionProposal }) {
  const resolved = 'baseVersion' in revision && 'targetVersion' in revision
  return (
    <section aria-label="修改计划" className="mt-4 space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">确认本次修改</h2>
          {resolved && (
            <p className="text-muted-foreground mt-1 text-xs">
              基于 v{revision.baseVersion} 生成候选 v{revision.targetVersion}
            </p>
          )}
        </div>
        <Badge variant="secondary">
          {revision.strategy === 'patch' ? <PencilLine aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          {revision.strategy === 'patch' ? '基于当前版本修改' : '从原始方案重新生成'}
        </Badge>
      </div>
      <p className="text-sm font-medium">{revision.summary}</p>
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <h3 className="font-medium">将修改</h3>
          <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-4">
            {revision.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
        {revision.preserved.length > 0 && (
          <div>
            <h3 className="font-medium">保持不变</h3>
            <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-4">
              {revision.preserved.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

function assetsForProposal(proposal: ConfirmationProposal, assets: SafePlayableAsset[]): SafePlayableAsset[] {
  return assets.filter((asset) => {
    if (!isPlayableResourceAssetSlot(asset.slot)) return true
    const resource = proposal.resources[asset.slot]
    if (resource.status !== '用户上传') return false
    return resource.treatment
      .split('、')
      .map((filename) => filename.trim())
      .includes(asset.filename)
  })
}

export function ChatWorkspace({
  taskId,
  initialPrompt = '',
  phase,
  proposal,
  revision,
  hasArtifact = false,
  brief,
  onProposal,
  onRevision,
  onBrief,
  onPhase,
  autoSubmitInitialPrompt = false,
  initialConversation = [],
  initialAssets = [],
  videoAnalysisStatus,
  gameplayBlueprint,
  onAssetsChange,
  onVideoAnalysisToolStatus,
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
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([])
  const [completedTools, setCompletedTools] = useState<string[]>([])
  const [toolStatuses, setToolStatuses] = useState<Record<string, 'started' | 'completed' | 'failed'>>({})
  const [error, setError] = useState('')
  const streamController = useRef<AbortController | undefined>(undefined)
  const scrollContainer = useRef<HTMLDivElement>(null)
  const composerAttachmentInput = useRef<HTMLInputElement>(null)
  const composerAttachmentSequence = useRef(0)
  const selectedAssetsRef = useRef(initialAssets)
  const autoSubmitted = useRef(false)
  const canCompose = ['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(
    phase,
  )
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

  const updateSelectedAssets = useCallback(
    (assets: SafePlayableAsset[]) => {
      selectedAssetsRef.current = assets
      setSelectedAssets(assets)
      onAssetsChange?.(assets)
    },
    [onAssetsChange],
  )

  const sendMessage = useCallback(
    async (contentOverride?: string, appendToConversation = true, existingAttachmentIds: string[] = []) => {
      const attachmentSnapshot = appendToConversation
        ? composerAttachments.map((attachment) => ({ ...attachment }))
        : []
      const enteredContent = (contentOverride ?? message).trim()
      const content =
        enteredContent ||
        (attachmentSnapshot.length > 0
          ? `请参考已上传素材：${attachmentSnapshot.map((attachment) => attachment.filename).join('、')}`
          : '')
      if (!content || sending || !canCompose) return
      const id = Date.now()
      const assistantId = `assistant-${id}`
      const controller = new AbortController()
      let terminalEventReceived = false
      streamController.current = controller
      setSending(true)
      setCompletedTools([])
      setToolStatuses({})
      setError('')
      try {
        let resolvedAttachments = attachmentSnapshot
        let uploadFailed = false
        for (const attachment of attachmentSnapshot) {
          if (attachment.status === 'uploaded' && attachment.asset) continue
          setComposerAttachments((items) =>
            items.map((item) => (item.id === attachment.id ? { ...item, status: 'uploading' } : item)),
          )
          try {
            const slot = referenceSlotForMimeType(attachment.file.type)
            if (!slot) throw new Error('仅支持 PNG、JPEG、WebP、GIF、MP4 和 WebM 参考素材')
            const body = new FormData()
            body.set('slot', slot)
            body.set('file', attachment.file)
            const uploadResponse = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/assets`, {
              method: 'POST',
              body,
              signal: controller.signal,
            })
            if (!uploadResponse.ok) throw new Error('素材上传失败')
            const result = (await uploadResponse.json()) as { asset: SafePlayableAsset }
            resolvedAttachments = resolvedAttachments.map((item) =>
              item.id === attachment.id ? { ...item, status: 'uploaded', asset: result.asset } : item,
            )
            setComposerAttachments((items) =>
              items.map((item) =>
                item.id === attachment.id ? { ...item, status: 'uploaded', asset: result.asset } : item,
              ),
            )
            if (!selectedAssetsRef.current.some((asset) => asset.id === result.asset.id)) {
              updateSelectedAssets([...selectedAssetsRef.current, result.asset])
            }
          } catch (cause) {
            uploadFailed = true
            resolvedAttachments = resolvedAttachments.map((item) =>
              item.id === attachment.id ? { ...item, status: 'failed' } : item,
            )
            setComposerAttachments((items) =>
              items.map((item) => (item.id === attachment.id ? { ...item, status: 'failed' } : item)),
            )
            setError(
              controller.signal.aborted
                ? '已停止生成确认方案'
                : cause instanceof Error
                  ? cause.message
                  : '素材上传失败',
            )
          }
        }
        if (uploadFailed) return

        const attachments = resolvedAttachments.flatMap((attachment): ConversationAttachment[] =>
          attachment.asset
            ? [
                {
                  id: attachment.asset.id,
                  filename: attachment.asset.filename,
                  mimeType: attachment.asset.mimeType,
                },
              ]
            : [],
        )
        const attachmentIds = appendToConversation
          ? attachments.map((attachment) => attachment.id)
          : existingAttachmentIds
        if (appendToConversation) {
          setConversation((items) => [...items, { id, role: 'user', content, status: 'sending', attachments }])
        }
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
          }),
          signal: controller.signal,
        })
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
            revision?: RevisionProposal
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
          } else if (['tool_started', 'tool_completed', 'tool_failed'].includes(event.type) && event.tool) {
            const status = event.type.slice('tool_'.length) as 'started' | 'completed' | 'failed'
            setToolStatuses((items) => ({ ...items, [event.tool!]: status }))
            if (status === 'completed') {
              setCompletedTools((items) => (items.includes(event.tool!) ? items : [...items, event.tool!]))
            }
            if (event.tool === 'analyze_reference_video') onVideoAnalysisToolStatus?.(status)
          } else if (event.type === 'informational' && event.message) {
            terminalEventReceived = true
            if (event.brief) onBrief?.(event.brief)
            updateAssistant({ content: event.message, reasoning: event.reasoning, status: 'sent' })
          } else if (event.type === 'confirmation' && event.confirmation) {
            terminalEventReceived = true
            if (event.brief) onBrief?.(event.brief)
            onRevision?.(undefined)
            onProposal(event.confirmation)
            onPhase('awaiting_confirmation')
            if (event.message) {
              updateAssistant({
                content: event.message,
                reasoning: event.reasoning,
                confirmation: event.confirmation,
                status: 'sent',
              })
            }
          } else if (event.type === 'revision' && event.confirmation && event.revision) {
            terminalEventReceived = true
            if (event.brief) onBrief?.(event.brief)
            onProposal(event.confirmation)
            onRevision?.(event.revision)
            onPhase('awaiting_revision_confirmation')
            if (event.message) {
              updateAssistant({
                content: event.message,
                reasoning: event.reasoning,
                confirmation: event.confirmation,
                revision: event.revision,
                status: 'sent',
              })
            }
          } else if (event.type === 'clarification' && event.message) {
            terminalEventReceived = true
            if (event.brief) onBrief?.(event.brief)
            onRevision?.(undefined)
            if (hasArtifact) onPhase('ready')
            else {
              onProposal(undefined)
              onPhase('draft')
            }
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
        setComposerAttachments([])
      } catch (cause) {
        if (terminalEventReceived) {
          setMessage('')
          setComposerAttachments([])
        } else {
          if (controller.signal.aborted) setError('已停止生成确认方案')
          else setError(cause instanceof Error ? cause.message : '请求失败，请稍后重试')
          setConversation((items) =>
            items.map((item) => (item.id === assistantId ? { ...item, status: 'failed' } : item)),
          )
        }
      } finally {
        if (streamController.current === controller) streamController.current = undefined
        setSending(false)
      }
    },
    [
      canCompose,
      composerAttachments,
      hasArtifact,
      message,
      onBrief,
      onPhase,
      onProposal,
      onRevision,
      onVideoAnalysisToolStatus,
      sending,
      taskId,
      updateSelectedAssets,
    ],
  )

  useEffect(() => {
    if (!autoSubmitInitialPrompt || !initialPrompt || phase !== 'draft' || autoSubmitted.current) return
    autoSubmitted.current = true
    void sendMessage(
      initialPrompt,
      false,
      initialAssets.map((asset) => asset.id),
    )
  }, [autoSubmitInitialPrompt, initialAssets, initialPrompt, phase, sendMessage])

  function updateCurrentProposal(nextProposal: ConfirmationProposal) {
    onProposal(nextProposal)
    setConversation((items) => {
      const latestProposalIndex = items.findLastIndex(
        (item) => item.role === 'assistant' && item.confirmation !== undefined,
      )
      if (latestProposalIndex < 0) return items
      return items.map((item, index) =>
        index === latestProposalIndex ? { ...item, confirmation: nextProposal } : item,
      )
    })
  }

  async function upload(slot: PlayableAssetSlot, files: File[]) {
    if (!proposal || !['awaiting_confirmation', 'awaiting_revision_confirmation', 'failed'].includes(phase)) return
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
        const nextAssets = [...selectedAssets, ...uploaded]
        updateSelectedAssets(nextAssets)
        if (isPlayableResourceAssetSlot(slot)) {
          const slotAssets = [...selectedAssets, ...uploaded].filter((asset) => asset.slot === slot)
          updateCurrentProposal({
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

  function stageComposerFiles(files: File[]) {
    setComposerAttachments((items) => {
      const localOnlyCount = items.filter((attachment) => !attachment.asset).length
      const remainingCapacity = Math.max(
        0,
        Math.min(
          MAX_HOME_ATTACHMENTS - items.length,
          MAX_TASK_ASSETS - selectedAssetsRef.current.length - localOnlyCount,
        ),
      )
      if (remainingCapacity === 0) {
        setError('已达到素材上传数量上限')
        return items
      }
      const staged: ComposerAttachment[] = []
      let validationError = files.length > remainingCapacity ? '部分素材超出数量上限，已自动忽略' : ''
      for (const file of files.slice(0, remainingCapacity)) {
        const slot = referenceSlotForMimeType(file.type)
        if (!slot) {
          validationError = '仅支持 PNG、JPEG、WebP、GIF、MP4 和 WebM 参考素材'
          continue
        }
        if (file.size <= 0 || file.size > maxAssetBytesForSlot(slot)) {
          validationError = slot === 'referenceVideo' ? '单个参考视频不能超过 14 MiB' : '单个参考素材不能超过 4 MiB'
          continue
        }
        composerAttachmentSequence.current += 1
        staged.push({
          id: `composer-attachment-${composerAttachmentSequence.current}`,
          file,
          filename: file.name,
          mimeType: file.type,
          status: 'staged',
        })
      }
      setError(validationError)
      return [...items, ...staged]
    })
  }

  async function removeComposerAttachment(attachment: ComposerAttachment) {
    if (attachment.status === 'uploading' || sending) return
    if (!attachment.asset) {
      setComposerAttachments((items) => items.filter((candidate) => candidate.id !== attachment.id))
      return
    }
    setRemovingAssetId(attachment.asset.id)
    setError('')
    try {
      const response = await fetch(
        `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(attachment.asset.id)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw new Error('删除素材失败')
      setComposerAttachments((items) => items.filter((candidate) => candidate.id !== attachment.id))
      updateSelectedAssets(selectedAssetsRef.current.filter((asset) => asset.id !== attachment.asset?.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除素材失败')
    } finally {
      setRemovingAssetId(undefined)
    }
  }

  async function removeAsset(asset: SafePlayableAsset) {
    if (
      !proposal ||
      !['awaiting_confirmation', 'awaiting_revision_confirmation', 'failed'].includes(phase) ||
      removingAssetId
    )
      return
    setRemovingAssetId(asset.id)
    setError('')
    try {
      const response = await fetch(
        `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(asset.id)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) throw new Error('删除素材失败')
      const remaining = selectedAssets.filter((candidate) => candidate.id !== asset.id)
      updateSelectedAssets(remaining)
      if (isPlayableResourceAssetSlot(asset.slot)) {
        const slotAssets = remaining.filter((candidate) => candidate.slot === asset.slot)
        updateCurrentProposal({
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
    const confirmsRevision = Boolean(hasArtifact && revision)
    const canConfirmPhase = confirmsRevision
      ? phase === 'awaiting_revision_confirmation' || phase === 'failed'
      : phase === 'awaiting_confirmation' || phase === 'failed'
    if (!proposal || confirming || !canConfirmPhase) return
    setConfirming(true)
    setError('')
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          confirmsRevision ? { revisionId: revision?.id, confirmation: proposal } : { confirmation: proposal },
        ),
      })
      if (response.status === 409) throw new Error('方案状态已变化，请刷新后重试')
      if (!response.ok) throw new Error('无法开始构建')
      onPhase('building')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法开始构建')
    } finally {
      setConfirming(false)
    }
  }

  const latestProposalIndex = conversation.findLastIndex(
    (item) => item.role === 'assistant' && item.confirmation !== undefined,
  )
  const showsInitialConfirmation = Boolean(proposal && !hasArtifact)
  const showsRevisionConfirmation = Boolean(proposal && hasArtifact && revision)
  const initialConfirmationReady = proposal ? isConfirmationReady(proposal) : false
  const buildInProgress = phase === 'building' || phase === 'validating'
  const confirmActionVisible = showsInitialConfirmation || showsRevisionConfirmation
  const confirmablePhase = showsRevisionConfirmation
    ? phase === 'awaiting_revision_confirmation' || phase === 'failed'
    : phase === 'awaiting_confirmation' || phase === 'failed'
  const confirmActionDisabled =
    confirming ||
    sending ||
    buildInProgress ||
    !confirmablePhase ||
    (!showsRevisionConfirmation && !initialConfirmationReady)
  const confirmActionLabel = showsRevisionConfirmation
    ? `确认修改并生成 v${revision?.targetVersion}`
    : '确认方案并开始构建'

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

        {Object.keys(toolStatuses).length > 0 && (
          <section aria-label="本轮 Agent 工具" className="flex flex-wrap gap-1">
            {Object.entries(toolStatuses).map(([tool, status]) => (
              <Badge key={tool} variant={status === 'failed' ? 'destructive' : 'secondary'}>
                {requirementToolLabels[tool] ?? '业务工具'}
                {status === 'started' ? '进行中' : status === 'completed' ? '完成' : '失败'}
              </Badge>
            ))}
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

        {conversation.map((item, index) =>
          item.role === 'user' ? (
            <div
              key={item.id}
              className="bg-primary text-primary-foreground ml-auto w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-3 text-sm"
            >
              {item.content}
              {item.attachments && item.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.attachments.map((attachment) => (
                    <span key={attachment.id} className="rounded-md border border-current/20 px-2 py-1 text-xs">
                      <span>{attachment.filename}</span>
                      <span> · 已上传</span>
                    </span>
                  ))}
                </div>
              )}
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
                {item.revision && (
                  <RevisionSummary revision={index === latestProposalIndex && revision ? revision : item.revision} />
                )}
                {item.confirmation &&
                  (index === latestProposalIndex && confirmActionVisible ? (
                    <div className="mt-4">
                      <ConfirmationTable
                        proposal={proposal ?? item.confirmation}
                        onChange={updateCurrentProposal}
                        onConfirm={confirm}
                        title={
                          item.revision && 'targetVersion' in item.revision
                            ? `候选构建方案 v${item.revision.targetVersion}`
                            : '候选构建方案 v1'
                        }
                        description="你可以继续调整配置或上传素材，确认后才会开始构建。"
                        confirming={confirming}
                        buildPhase={buildInProgress ? phase : undefined}
                        disabled={sending || buildInProgress}
                        uploadingSlot={uploadingSlot}
                        onUpload={upload}
                        onRemoveAsset={removeAsset}
                        uploadedAssets={selectedAssets}
                        removingAssetId={removingAssetId}
                        assetPreviewUrl={(asset) =>
                          `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(asset.id)}`
                        }
                        showConfirmAction={false}
                      />
                    </div>
                  ) : (
                    <details className="mt-4 overflow-hidden rounded-xl border">
                      <summary className="bg-muted/30 cursor-pointer select-none px-4 py-3 text-sm font-semibold">
                        历史构建方案
                      </summary>
                      <div className="border-t p-4">
                        <ConfirmationTable
                          proposal={item.confirmation}
                          onChange={() => undefined}
                          onConfirm={() => undefined}
                          showHeader={false}
                          disabled
                          uploadedAssets={assetsForProposal(item.confirmation, selectedAssets)}
                          assetPreviewUrl={(asset) =>
                            `/api/playable-tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(asset.id)}`
                          }
                          showConfirmAction={false}
                        />
                      </div>
                    </details>
                  ))}
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

        {showsInitialConfirmation && proposal && latestProposalIndex < 0 && (
          <div>
            <ConfirmationTable
              proposal={proposal}
              onChange={updateCurrentProposal}
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
              showConfirmAction={false}
            />
          </div>
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

      {confirmActionVisible && (
        <section
          aria-label="待确认操作"
          className="bg-background shrink-0 border-t px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {showsRevisionConfirmation ? `v${revision?.targetVersion} 修改计划待确认` : '最新方案待确认'}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {sending
                  ? '正在更新方案…'
                  : buildInProgress
                    ? phase === 'building'
                      ? 'Codex 正在构建试玩…'
                      : '正在验证并发布试玩…'
                    : '确认后才会开始耗时构建'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" size="sm" disabled={confirmActionDisabled} onClick={() => void confirm()}>
                {confirming || buildInProgress ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                {confirmActionLabel}
              </Button>
            </div>
          </div>
        </section>
      )}

      <div className="bg-background shrink-0 border-t p-4">
        <div className="focus-within:ring-ring/40 rounded-2xl border p-2 shadow-sm focus-within:ring-2">
          {composerAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-1" aria-live="polite">
              {composerAttachments.map((attachment) => (
                <span key={attachment.id} className="bg-muted flex items-center gap-1.5 rounded-md px-2 py-1 text-xs">
                  {attachment.status === 'uploading' ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  ) : attachment.status === 'uploaded' ? (
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                  ) : null}
                  <span>{attachment.filename}</span>
                  <span className={attachment.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                    {attachment.status === 'uploading'
                      ? '上传中…'
                      : attachment.status === 'uploaded'
                        ? '已上传'
                        : attachment.status === 'failed'
                          ? '上传失败'
                          : '待上传'}
                  </span>
                  {attachment.status !== 'uploading' && (
                    <button
                      type="button"
                      aria-label={`移除附件 ${attachment.filename}`}
                      disabled={Boolean(attachment.asset && removingAssetId === attachment.asset.id)}
                      onClick={() => void removeComposerAttachment(attachment)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <Textarea
            aria-label="试玩需求"
            placeholder={
              canCompose
                ? hasArtifact
                  ? '描述你想修改的内容…'
                  : '描述你想制作的试玩…'
                : '当前阶段不可继续输入，请新建试玩'
            }
            className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0"
            value={message}
            disabled={!canCompose || sending}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              void sendMessage()
            }}
          />
          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="添加参考图片或视频"
              disabled={!canCompose || sending}
              onClick={() => composerAttachmentInput.current?.click()}
            >
              <Paperclip aria-hidden="true" />
            </Button>
            <input
              ref={composerAttachmentInput}
              className="sr-only"
              type="file"
              multiple
              accept={PLAYABLE_REFERENCE_ACCEPT}
              aria-label="选择参考图片或视频"
              disabled={!canCompose || sending}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                stageComposerFiles(files)
              }}
            />
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
                disabled={(!message.trim() && composerAttachments.length === 0) || !canCompose}
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
