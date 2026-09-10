'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, Paperclip, Sparkles } from 'lucide-react'
import type { Session } from '@/lib/session/types'
import type {
  ConfirmationProposal,
  GameplayBlueprint,
  PlayableTaskPhase,
  RequirementBrief,
  RevisionProposal,
  VideoAnalysisStatus,
} from '@/lib/playable/schemas'
import { User } from '@/components/auth/user'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ChatWorkspace } from './chat-workspace'
import type { ConversationMessage } from './chat-workspace'
import { PlayablePreview } from './playable-preview'
import { AssetPreviewList } from './asset-preview-list'
import {
  MAX_HOME_ATTACHMENTS,
  PLAYABLE_REFERENCE_ACCEPT,
  maxAssetBytesForSlot,
  referenceSlotForMimeType,
} from '@/lib/playable/asset-policy'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'
import type { PlayableValidationSummary } from '@/lib/playable/playable-agent-adapter'
import { PLAYABLE_MODES } from '@/lib/playable/template-registry'
import type { PlayableModeId } from '@/lib/playable/types'
import { PlayableStudioShell } from './studio-shell'
import type { PlayableTaskSummary } from './studio-shell'
import { TemplatePreview } from './template-preview'
import { TemplatePreviewDialog } from './template-preview-dialog'

interface PlayableWorkspaceProps {
  taskId: string
  /** @deprecated Shared credentials are configured server-side. */
  initialApiKeyConfigured?: boolean
  initialPrompt?: string
  initialPhase?: PlayableTaskPhase
  initialProposal?: ConfirmationProposal
  initialRevision?: RevisionProposal
  initialBrief?: RequirementBrief
  initialHasArtifact?: boolean
  initialArtifactVersion?: string | null
  initialBuildId?: string
  initialBuildFailureMessage?: string
  initialValidation?: PlayableValidationSummary | null
  localDemo?: boolean
  localCodex?: boolean
  localHarness?: boolean
  publicAccess?: boolean
  initialConversation?: ConversationMessage[]
  initialAssets?: SafePlayableAsset[]
  initialVideoAnalysisStatus?: VideoAnalysisStatus
  initialGameplayBlueprint?: GameplayBlueprint
}

const phaseRank: Record<PlayableTaskPhase, number> = {
  draft: 0,
  awaiting_confirmation: 1,
  awaiting_revision_confirmation: 1,
  building: 2,
  validating: 3,
  reviewing: 4,
  ready: 5,
  needs_plugin: 5,
  failed: 5,
  cancelled: 5,
}

export function PlayableWorkspace({
  taskId,
  initialPrompt,
  initialPhase = 'draft',
  initialProposal,
  initialRevision,
  initialBrief,
  initialHasArtifact = false,
  initialArtifactVersion = null,
  initialBuildId,
  initialBuildFailureMessage,
  initialValidation = null,
  localDemo = false,
  localCodex = false,
  localHarness = false,
  publicAccess = false,
  initialConversation = [],
  initialAssets = [],
  initialVideoAnalysisStatus,
  initialGameplayBlueprint,
}: PlayableWorkspaceProps) {
  const [phase, setPhase] = useState<PlayableTaskPhase>(initialPhase)
  const [proposalDraft, setProposalDraft] = useState(initialProposal)
  const [revisionDraft, setRevisionDraft] = useState(initialRevision)
  const [brief, setBrief] = useState(initialBrief)
  const [hasArtifact, setHasArtifact] = useState(initialHasArtifact)
  const [artifactVersion, setArtifactVersion] = useState(initialArtifactVersion)
  const [buildFailureMessage, setBuildFailureMessage] = useState(initialBuildFailureMessage)
  const [validation, setValidation] = useState<PlayableValidationSummary | null>(initialValidation)
  const [videoAnalysisStatus, setVideoAnalysisStatus] = useState<VideoAnalysisStatus | undefined>(
    initialVideoAnalysisStatus,
  )
  const [gameplayBlueprint, setGameplayBlueprint] = useState<GameplayBlueprint | undefined>(initialGameplayBlueprint)
  const [assets, setAssets] = useState(initialAssets)
  const latestReferenceVideoId = useRef(initialAssets.filter((asset) => asset.slot === 'referenceVideo').at(-1)?.id)

  useEffect(() => {
    if (!videoAnalysisStatus || !['pending', 'preprocessing', 'analyzing'].includes(videoAnalysisStatus)) return
    let active = true
    let timeout: number | undefined
    const poll = async () => {
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as {
          analysis?: { status: VideoAnalysisStatus; blueprint: GameplayBlueprint | null }
        }
        if (!active || !body.analysis) return
        setVideoAnalysisStatus(body.analysis.status)
        setGameplayBlueprint(body.analysis.blueprint ?? undefined)
      } catch {
        // Keep polling after transient analysis status failures.
      } finally {
        if (active) timeout = window.setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [taskId, videoAnalysisStatus])

  useEffect(() => {
    if (!['building', 'validating'].includes(phase)) return
    let active = true
    let timeout: number | undefined
    const poll = async () => {
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/events`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as {
          task?: {
            phase: PlayableTaskPhase
            hasArtifact: boolean
            artifactVersion: string | null
            latestValidation: PlayableValidationSummary | null
            requirementBrief: RequirementBrief | null
            confirmation: ConfirmationProposal | null
            pendingRevision: RevisionProposal | null
          }
          events?: Array<{ type: string; message?: string }>
        }
        if (!active || !body.task) return
        setPhase((current) => (phaseRank[body.task!.phase] >= phaseRank[current] ? body.task!.phase : current))
        if (body.task.phase === 'failed') {
          setBuildFailureMessage(body.events?.findLast((event) => event.type === 'build_failed')?.message)
        }
        if (body.task.requirementBrief) setBrief(body.task.requirementBrief)
        if (body.task.confirmation) setProposalDraft(body.task.confirmation)
        setRevisionDraft(body.task.pendingRevision ?? undefined)
        setHasArtifact(body.task.hasArtifact)
        setArtifactVersion(body.task.artifactVersion)
        setValidation(body.task.latestValidation)
      } catch {
        // A transient polling failure must not clear the last successful preview.
      } finally {
        if (active) timeout = window.setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      active = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [phase, taskId])

  const handleAssetsChange = useCallback((nextAssets: SafePlayableAsset[]) => {
    const nextReferenceVideoId = nextAssets.filter((asset) => asset.slot === 'referenceVideo').at(-1)?.id
    if (nextReferenceVideoId !== latestReferenceVideoId.current) {
      latestReferenceVideoId.current = nextReferenceVideoId
      setVideoAnalysisStatus(undefined)
      setGameplayBlueprint(undefined)
    }
    setAssets(nextAssets)
  }, [])
  const handleVideoAnalysisToolStatus = useCallback(
    async (status: 'started' | 'completed' | 'failed') => {
      if (status === 'started') {
        setVideoAnalysisStatus('analyzing')
        return
      }
      if (status === 'failed') {
        setVideoAnalysisStatus('failed')
        return
      }
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, {
          cache: 'no-store',
        })
        if (!response.ok) {
          setVideoAnalysisStatus('failed')
          return
        }
        const body = (await response.json()) as {
          analysis?: { status: VideoAnalysisStatus; blueprint: GameplayBlueprint | null }
        }
        if (!body.analysis) {
          setVideoAnalysisStatus('failed')
          return
        }
        setVideoAnalysisStatus(body.analysis.status)
        setGameplayBlueprint(body.analysis.blueprint ?? undefined)
      } catch {
        setVideoAnalysisStatus('failed')
      }
    },
    [taskId],
  )

  return (
    <main className="bg-background flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="试玩工作台首页">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Sparkles className="size-4" />
          </span>
          Playable Studio
        </Link>
        {localDemo ? (
          <Badge variant="secondary">本地演示 · 数据不保存</Badge>
        ) : localCodex || localHarness ? (
          <Badge variant="secondary">{localHarness ? '本地 Harness · 线上 Agent' : '本地 Codex · 实际数据'}</Badge>
        ) : publicAccess ? (
          <Badge variant="secondary">公开体验</Badge>
        ) : (
          <User />
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(22rem,0.78fr)_minmax(32rem,1.22fr)]">
        <ChatWorkspace
          taskId={taskId}
          initialPrompt={initialPrompt}
          phase={phase}
          proposal={proposalDraft}
          revision={revisionDraft}
          hasArtifact={hasArtifact}
          brief={brief}
          onProposal={setProposalDraft}
          onRevision={setRevisionDraft}
          onBrief={setBrief}
          onPhase={setPhase}
          autoSubmitInitialPrompt={initialConversation.length === 0}
          initialConversation={initialConversation}
          initialAssets={assets}
          videoAnalysisStatus={videoAnalysisStatus}
          gameplayBlueprint={gameplayBlueprint}
          onAssetsChange={handleAssetsChange}
          onVideoAnalysisToolStatus={(status) => void handleVideoAnalysisToolStatus(status)}
        />
        <PlayablePreview
          taskId={taskId}
          phase={phase}
          hasArtifact={hasArtifact}
          artifactVersion={artifactVersion}
          initialBuildId={initialBuildId}
          confirmation={proposalDraft}
          revision={revisionDraft}
          onPhase={setPhase}
          failureMessage={buildFailureMessage}
          initialValidation={validation}
        />
      </div>
    </main>
  )
}

interface HomeAttachment {
  id: string
  file: File
  previewUrl?: string
}

interface PlayableHomeProps {
  user: Session['user'] | null
  authProvider: Session['authProvider'] | null
  localDemo?: boolean
  localCodex?: boolean
  localHarness?: boolean
  publicAccess?: boolean
}

const templatePrompts: Record<PlayableModeId, string> = {
  center_collision: '基于「中心碰撞」玩法模板开始迭代：保留相同牌向中心碰撞并消除计分的核心玩法。',
  top_rack: '基于「上方牌架」玩法模板开始迭代：保留可见牌进入四槽牌架并配对清除的核心玩法。',
  gravity_fill: '基于「下落补位」玩法模板开始迭代：保留网格配对消除、列下落和顶部补位的核心玩法。',
  perspective_3d: '基于「3D 纵深」玩法模板开始迭代：保留移除顶层牌面并逐层揭示下方内容的核心玩法。',
}

export function PlayableHome({
  user,
  authProvider,
  localDemo = false,
  localCodex = false,
  localHarness = false,
  publicAccess = false,
}: PlayableHomeProps) {
  const router = useRouter()
  const attachmentInput = useRef<HTMLInputElement>(null)
  const attachmentSequence = useRef(0)
  const attachmentUrls = useRef(new Set<string>())
  const attachmentsRef = useRef<HomeAttachment[]>([])
  const creatingRef = useRef(false)
  const retryRef = useRef<{ fingerprint: string; taskId: string; uploadedIds: Set<string> } | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<HomeAttachment[]>([])
  const [tasks, setTasks] = useState<PlayableTaskSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState<PlayableModeId>()
  const [previewMode, setPreviewMode] = useState<PlayableModeId>()
  const [error, setError] = useState('')

  useEffect(
    () => () => {
      for (const url of attachmentUrls.current) URL.revokeObjectURL(url)
    },
    [],
  )

  useEffect(() => {
    if (!user) return
    void fetch('/api/playable-tasks', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('加载试玩列表失败')
        return (await response.json()) as { tasks: PlayableTaskSummary[] }
      })
      .then((body) => setTasks(body.tasks))
      .catch((cause) => setError(cause instanceof Error ? cause.message : '加载试玩列表失败'))
  }, [user])

  async function createPlayable() {
    const content = prompt.trim() || '请根据上传的参考素材制作试玩'
    const attachmentSnapshot = attachmentsRef.current
    if ((!prompt.trim() && attachmentSnapshot.length === 0) || creatingRef.current) return
    const fingerprint = JSON.stringify({
      content,
      attachments: attachmentSnapshot.map(({ id, file }) => ({
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    })
    creatingRef.current = true
    setCreating(true)
    setError('')
    try {
      let retry = retryRef.current
      if (!retry || retry.fingerprint !== fingerprint) {
        const response = await fetch('/api/playable-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content }),
        })
        if (!response.ok) throw new Error('创建试玩失败')
        const body = (await response.json()) as { task: { id: string } }
        retry = { fingerprint, taskId: body.task.id, uploadedIds: new Set() }
        retryRef.current = retry
      }
      for (const { id, file } of attachmentSnapshot) {
        if (retry.uploadedIds.has(id)) continue
        const slot = referenceSlotForMimeType(file.type)
        if (!slot) throw new Error('参考素材格式不受支持')
        const uploadBody = new FormData()
        uploadBody.set('slot', slot)
        uploadBody.set('file', file)
        const uploadResponse = await fetch(`/api/playable-tasks/${encodeURIComponent(retry.taskId)}/assets`, {
          method: 'POST',
          body: uploadBody,
        })
        if (!uploadResponse.ok) throw new Error('参考素材上传失败')
        retry.uploadedIds.add(id)
      }
      retryRef.current = undefined
      router.push(`/tasks/${retry.taskId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建试玩失败')
      setCreating(false)
    } finally {
      creatingRef.current = false
    }
  }

  async function createFromTemplate(mode: PlayableModeId) {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreatingTemplate(mode)
    setError('')
    try {
      const response = await fetch('/api/playable-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: templatePrompts[mode] }),
      })
      if (!response.ok) throw new Error('无法从模板创建试玩')
      const body = (await response.json()) as { task: { id: string } }
      router.push(`/tasks/${body.task.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法从模板创建试玩')
      setCreatingTemplate(undefined)
    } finally {
      creatingRef.current = false
    }
  }

  function addAttachments(files: FileList | null) {
    if (!files) return
    const accepted: HomeAttachment[] = []
    const remaining = Math.max(0, MAX_HOME_ATTACHMENTS - attachmentsRef.current.length)
    for (const file of Array.from(files)) {
      if (accepted.length >= remaining) {
        setError(`最多可以添加 ${MAX_HOME_ATTACHMENTS} 个参考素材`)
        break
      }
      const slot = referenceSlotForMimeType(file.type)
      if (!slot) {
        setError('仅支持 PNG、JPEG、WebP、GIF、MP4 和 WebM 参考素材')
        continue
      }
      if (file.size <= 0 || file.size > maxAssetBytesForSlot(slot)) {
        setError(slot === 'referenceVideo' ? '单个参考视频不能超过 100 MiB' : '单个参考素材不能超过 4 MiB')
        continue
      }
      const previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
      if (previewUrl) attachmentUrls.current.add(previewUrl)
      attachmentSequence.current += 1
      accepted.push({ id: `attachment-${attachmentSequence.current}`, file, previewUrl })
    }
    const next = [...attachmentsRef.current, ...accepted]
    attachmentsRef.current = next
    setAttachments(next)
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
        attachmentUrls.current.delete(target.previewUrl)
      }
      const next = current.filter((attachment) => attachment.id !== id)
      attachmentsRef.current = next
      return next
    })
  }

  const accountLabel = publicAccess
    ? '公开体验 · 任务共享'
    : user?.name || user?.username || (authProvider === 'github' ? 'GitHub 用户' : 'Playable Studio')

  return (
    <PlayableStudioShell activeSection="home" accountLabel={accountLabel} tasks={tasks}>
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:pt-24 lg:pb-16">
        <section className="mx-auto max-w-4xl text-center" aria-labelledby="home-heading">
          <h1 id="home-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            想做一个什么样的试玩？
          </h1>
          <p className="text-muted-foreground mt-3 text-sm sm:text-base">
            说说你的玩法想法，或上传参考素材，我们从这里开始。
          </p>
          <div className="bg-background mt-6 rounded-2xl border p-2.5 text-left">
            <Textarea
              aria-label="新试玩需求"
              placeholder="描述玩法、视觉方向，或上传参考素材…"
              className="min-h-20 resize-none border-0 px-2.5 py-2 text-base shadow-none focus-visible:ring-0"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={!user || creating || Boolean(creatingTemplate)}
            />
            {attachments.length > 0 && (
              <div className="mb-3 px-1">
                <AssetPreviewList
                  ariaLabel="已选择的参考素材"
                  items={attachments.map(({ id, file, previewUrl }) => ({
                    id,
                    filename: file.name,
                    mimeType: file.type,
                    size: file.size,
                    previewUrl,
                  }))}
                  disabled={creating}
                  onRemove={(item) => removeAttachment(item.id)}
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={!user || creating || attachments.length >= MAX_HOME_ATTACHMENTS}
                onClick={() => attachmentInput.current?.click()}
                aria-label="添加参考图片或视频"
              >
                <Paperclip aria-hidden="true" />
              </Button>
              <input
                ref={attachmentInput}
                className="sr-only"
                type="file"
                multiple
                accept={PLAYABLE_REFERENCE_ACCEPT}
                aria-label="上传参考图片或视频"
                disabled={!user || creating}
                onChange={(event) => {
                  addAttachments(event.target.files)
                  event.target.value = ''
                }}
              />
              <Button
                size="icon"
                className="rounded-full"
                onClick={() => void createPlayable()}
                disabled={!user || (!prompt.trim() && attachments.length === 0) || creating}
                aria-label="新建试玩"
              >
                {creating ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              </Button>
            </div>
          </div>
          {!user && !publicAccess && <p className="text-muted-foreground mt-3 text-sm">登录后即可创建并保存试玩。</p>}
          {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
        </section>

        <section className="mt-10" aria-labelledby="quick-start-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id="quick-start-heading" className="font-semibold">
              从玩法模板快速开始
            </h2>
            <Link href="/best-practices" className="text-muted-foreground hover:text-foreground text-sm">
              浏览全部模板 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PLAYABLE_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className="group overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5 hover:bg-muted/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                onClick={() => setPreviewMode(mode.id)}
                aria-label={`预览${mode.label}模板`}
              >
                <div className="relative aspect-[4/5] w-full border-b">
                  <TemplatePreview mode={mode.id} title={`${mode.label}模板封面`} className="absolute inset-0" />
                  <span className="bg-background/90 absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap shadow-sm backdrop-blur-sm">
                    点击试玩
                  </span>
                </div>
                <div className="min-h-24 px-3 py-3">
                  <h3 className="text-sm font-semibold">{mode.label}</h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">{mode.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
        <TemplatePreviewDialog
          mode={PLAYABLE_MODES.find((mode) => mode.id === previewMode)}
          creating={Boolean(previewMode && creatingTemplate === previewMode)}
          canStart={Boolean(user)}
          onOpenChange={(open) => {
            if (!open) setPreviewMode(undefined)
          }}
          onStart={(mode) => void createFromTemplate(mode.id)}
        />
      </main>
    </PlayableStudioShell>
  )
}
