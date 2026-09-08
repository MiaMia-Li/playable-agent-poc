'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, Paperclip, Plus, Sparkles } from 'lucide-react'
import type { Session } from '@/lib/session/types'
import type { ConfirmationProposal, PlayableTaskPhase, RequirementBrief } from '@/lib/playable/schemas'
import { User } from '@/components/auth/user'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ApiKeyDialog } from './api-key-dialog'
import { ChatWorkspace } from './chat-workspace'
import type { ConversationMessage } from './chat-workspace'
import { PlayablePreview } from './playable-preview'
import { AssetPreviewList } from './asset-preview-list'
import {
  MAX_ASSET_BYTES,
  MAX_HOME_ATTACHMENTS,
  PLAYABLE_REFERENCE_ACCEPT,
  referenceSlotForMimeType,
} from '@/lib/playable/asset-policy'
import type { SafePlayableAsset } from '@/lib/playable/task-assets'

interface PlayableWorkspaceProps {
  taskId: string
  initialApiKeyConfigured?: boolean
  initialPrompt?: string
  initialPhase?: PlayableTaskPhase
  initialProposal?: ConfirmationProposal
  initialBrief?: RequirementBrief
  initialHasArtifact?: boolean
  initialArtifactVersion?: string | null
  localDemo?: boolean
  localCodex?: boolean
  localHarness?: boolean
  initialConversation?: ConversationMessage[]
  initialAssets?: SafePlayableAsset[]
}

const phaseRank: Record<PlayableTaskPhase, number> = {
  draft: 0,
  awaiting_confirmation: 1,
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
  initialApiKeyConfigured,
  initialPrompt,
  initialPhase = 'draft',
  initialProposal,
  initialBrief,
  initialHasArtifact = false,
  initialArtifactVersion = null,
  localDemo = false,
  localCodex = false,
  localHarness = false,
  initialConversation = [],
  initialAssets = [],
}: PlayableWorkspaceProps) {
  const [apiKeyConfigured, setApiKeyConfigured] = useState(initialApiKeyConfigured)
  const [keyDialogOpen, setKeyDialogOpen] = useState(initialApiKeyConfigured === false)
  const [phase, setPhase] = useState<PlayableTaskPhase>(initialPhase)
  const [proposalDraft, setProposalDraft] = useState(initialProposal)
  const [brief, setBrief] = useState(initialBrief)
  const [hasArtifact, setHasArtifact] = useState(initialHasArtifact)
  const [artifactVersion, setArtifactVersion] = useState(initialArtifactVersion)

  useEffect(() => {
    if (initialApiKeyConfigured !== undefined) return
    let active = true
    void fetch('/api/session/openai-key/check', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to check API key')
        return (await response.json()) as { configured: boolean }
      })
      .then(({ configured }) => {
        if (!active) return
        setApiKeyConfigured(configured)
        setKeyDialogOpen(!configured)
      })
      .catch(() => {
        if (active) setKeyDialogOpen(true)
      })
    return () => {
      active = false
    }
  }, [initialApiKeyConfigured])

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
            requirementBrief: RequirementBrief | null
          }
        }
        if (!active || !body.task) return
        setPhase((current) => (phaseRank[body.task!.phase] >= phaseRank[current] ? body.task!.phase : current))
        if (body.task.requirementBrief) setBrief(body.task.requirementBrief)
        setHasArtifact(body.task.hasArtifact)
        setArtifactVersion(body.task.artifactVersion)
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

  const requireApiKey = useCallback(() => setKeyDialogOpen(true), [])

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
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{localHarness ? '本地 Harness · 线上 Agent' : '本地 Codex · 实际数据'}</Badge>
            <Button variant="outline" size="sm" onClick={requireApiKey}>
              {localHarness ? 'API Key' : '媒体 API Key'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={requireApiKey}>
              API Key
            </Button>
            <User />
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(22rem,0.78fr)_minmax(32rem,1.22fr)]">
        <ChatWorkspace
          taskId={taskId}
          initialPrompt={initialPrompt}
          phase={phase}
          proposal={proposalDraft}
          brief={brief}
          onProposal={setProposalDraft}
          onBrief={setBrief}
          onPhase={setPhase}
          onRequireApiKey={requireApiKey}
          autoSubmitInitialPrompt={apiKeyConfigured === true && initialConversation.length === 0}
          initialConversation={initialConversation}
          initialAssets={initialAssets}
        />
        <PlayablePreview
          taskId={taskId}
          phase={phase}
          hasArtifact={hasArtifact}
          artifactVersion={artifactVersion}
          confirmation={proposalDraft}
          onPhase={setPhase}
          onRequireApiKey={requireApiKey}
        />
      </div>
      {!localDemo && (
        <ApiKeyDialog
          open={keyDialogOpen}
          onOpenChange={setKeyDialogOpen}
          onConfigured={() => {
            setApiKeyConfigured(true)
            setKeyDialogOpen(false)
          }}
        />
      )}
    </main>
  )
}

interface PlayableTaskSummary {
  id: string
  prompt: string
  title?: string | null
  phase?: PlayableTaskPhase
  createdAt: string
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
}

const phaseNames: Partial<Record<PlayableTaskPhase, string>> = {
  draft: '整理方案',
  awaiting_confirmation: '方案待确认',
  building: '生成中',
  validating: '检查中',
  reviewing: '可试玩',
  ready: '可试玩',
  needs_plugin: '需要新增 Plugin',
  failed: '本次生成失败',
}

export function PlayableHome({
  user,
  authProvider,
  localDemo = false,
  localCodex = false,
  localHarness = false,
}: PlayableHomeProps) {
  const router = useRouter()
  const attachmentInput = useRef<HTMLInputElement>(null)
  const attachmentSequence = useRef(0)
  const attachmentUrls = useRef(new Set<string>())
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<HomeAttachment[]>([])
  const [tasks, setTasks] = useState<PlayableTaskSummary[]>([])
  const [loading, setLoading] = useState(Boolean(user))
  const [creating, setCreating] = useState(false)
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
      .finally(() => setLoading(false))
  }, [user])

  async function createPlayable() {
    const content = prompt.trim() || '请根据上传的参考素材制作试玩'
    if ((!prompt.trim() && attachments.length === 0) || creating) return
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/playable-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: content }),
      })
      if (!response.ok) throw new Error(response.status === 401 ? '请先登录' : '创建试玩失败')
      const body = (await response.json()) as { task: { id: string } }
      for (const { file } of attachments) {
        const slot = referenceSlotForMimeType(file.type)
        if (!slot) throw new Error('参考素材格式不受支持')
        const uploadBody = new FormData()
        uploadBody.set('slot', slot)
        uploadBody.set('file', file)
        const uploadResponse = await fetch(`/api/playable-tasks/${encodeURIComponent(body.task.id)}/assets`, {
          method: 'POST',
          body: uploadBody,
        })
        if (!uploadResponse.ok) throw new Error('参考素材上传失败')
      }
      router.push(`/tasks/${body.task.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建试玩失败')
      setCreating(false)
    }
  }

  function addAttachments(files: FileList | null) {
    if (!files) return
    const accepted: HomeAttachment[] = []
    const remaining = Math.max(0, MAX_HOME_ATTACHMENTS - attachments.length)
    for (const file of Array.from(files)) {
      if (accepted.length >= remaining) {
        setError(`最多可以添加 ${MAX_HOME_ATTACHMENTS} 个参考素材`)
        break
      }
      if (!referenceSlotForMimeType(file.type)) {
        setError('仅支持 PNG、JPEG、WebP、GIF、MP4 和 WebM 参考素材')
        continue
      }
      if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
        setError('单个参考素材不能超过 4 MiB')
        continue
      }
      const previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
      if (previewUrl) attachmentUrls.current.add(previewUrl)
      attachmentSequence.current += 1
      accepted.push({ id: `attachment-${attachmentSequence.current}`, file, previewUrl })
    }
    setAttachments((current) => [...current, ...accepted])
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
        attachmentUrls.current.delete(target.previewUrl)
      }
      return current.filter((attachment) => attachment.id !== id)
    })
  }

  return (
    <main className="bg-muted/20 min-h-dvh">
      <header className="bg-background flex h-16 items-center justify-between border-b px-5 sm:px-8">
        <div className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Sparkles className="size-4" />
          </span>
          Playable Studio
        </div>
        {localDemo || localCodex || localHarness ? (
          <Badge variant="secondary">
            {localHarness
              ? '本地 Harness · 线上 Agent'
              : localCodex
                ? '本地 Codex · 实际数据'
                : '本地演示 · 重启后清空'}
          </Badge>
        ) : (
          <User user={user} authProvider={authProvider} />
        )}
      </header>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4">
            AI 试玩创作工作台
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">把创意变成可玩的广告</h1>
          <p className="text-muted-foreground mt-4 text-base sm:text-lg">
            描述玩法与视觉方向，确认生成方案，即刻预览并下载安全的单 HTML 试玩。
          </p>
          <div className="bg-background mt-8 rounded-2xl border p-3 text-left shadow-lg">
            <Textarea
              aria-label="新试玩需求"
              placeholder="例如：制作一个竖屏麻将配对试玩，清爽夏日风格，结尾展示下载按钮…"
              className="min-h-28 resize-none border-0 shadow-none focus-visible:ring-0"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={!user || creating}
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
                size="sm"
                variant="ghost"
                disabled={!user || creating || attachments.length >= MAX_HOME_ATTACHMENTS}
                onClick={() => attachmentInput.current?.click()}
              >
                <Paperclip aria-hidden="true" />
                添加图片/视频
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
                onClick={() => void createPlayable()}
                disabled={!user || (!prompt.trim() && attachments.length === 0) || creating}
              >
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                新建试玩
              </Button>
            </div>
          </div>
          {!user && <p className="text-muted-foreground mt-3 text-sm">登录后即可创建并保存试玩。</p>}
          {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
        </div>

        {user && (
          <section aria-label="试玩任务列表" className="mt-16">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">最近试玩</h2>
              <span className="text-muted-foreground text-sm">{tasks.length} 个项目</span>
            </div>
            {loading ? (
              <p className="text-muted-foreground py-8 text-center">正在加载…</p>
            ) : tasks.length === 0 ? (
              <Card>
                <CardContent className="text-muted-foreground text-center">
                  还没有试玩，从上方输入一个创意开始。
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {tasks.map((task) => (
                  <Link key={task.id} href={`/tasks/${task.id}`} className="group">
                    <Card className="h-full py-4 transition-shadow hover:shadow-md">
                      <CardContent className="flex items-center justify-between gap-4 px-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{task.title || task.prompt}</p>
                          <p className="text-muted-foreground mt-1 text-xs">{phaseNames[task.phase ?? 'draft']}</p>
                        </div>
                        <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-1" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
