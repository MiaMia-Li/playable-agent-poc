'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, FileImage, FileVideo, Loader2, Paperclip, Plus, Sparkles, X } from 'lucide-react'
import type { Session } from '@/lib/session/types'
import type { ConfirmationProposal, PlayableTaskPhase } from '@/lib/playable/schemas'
import { User } from '@/components/auth/user'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ApiKeyDialog } from './api-key-dialog'
import { ChatWorkspace } from './chat-workspace'
import type { ConversationMessage } from './chat-workspace'
import { PlayablePreview } from './playable-preview'
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
  initialHasArtifact?: boolean
  initialArtifactVersion?: string | null
  localDemo?: boolean
  localCodex?: boolean
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
  initialHasArtifact = false,
  initialArtifactVersion = null,
  localDemo = false,
  localCodex = false,
  initialConversation = [],
  initialAssets = [],
}: PlayableWorkspaceProps) {
  const [apiKeyConfigured, setApiKeyConfigured] = useState(initialApiKeyConfigured)
  const [keyDialogOpen, setKeyDialogOpen] = useState(initialApiKeyConfigured === false)
  const [phase, setPhase] = useState<PlayableTaskPhase>(initialPhase)
  const [proposal, setProposal] = useState(initialProposal)
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
    if (['reviewing', 'ready', 'needs_plugin', 'failed', 'cancelled'].includes(phase)) return
    let active = true
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
            confirmation: ConfirmationProposal | null
          }
        }
        if (!active || !body.task) return
        setPhase((current) => (phaseRank[body.task!.phase] >= phaseRank[current] ? body.task!.phase : current))
        if (body.task.confirmation) setProposal(body.task.confirmation)
        setHasArtifact(body.task.hasArtifact)
        setArtifactVersion(body.task.artifactVersion)
      } catch {
        // A transient polling failure must not clear the last successful preview.
      }
    }
    void poll()
    const interval = window.setInterval(poll, 2000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [phase, taskId])

  const requireApiKey = useCallback(() => setKeyDialogOpen(true), [])

  return (
    <main className="bg-background flex min-h-dvh flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="试玩工作台首页">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Sparkles className="size-4" />
          </span>
          Playable Studio
        </Link>
        {localDemo ? (
          <Badge variant="secondary">本地演示 · 数据不保存</Badge>
        ) : localCodex ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">本地 Codex · 实际数据</Badge>
            <Button variant="outline" size="sm" onClick={requireApiKey}>
              媒体 API Key
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
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(22rem,0.78fr)_minmax(32rem,1.22fr)]">
        <ChatWorkspace
          taskId={taskId}
          initialPrompt={initialPrompt}
          phase={phase}
          proposal={proposal}
          onProposal={setProposal}
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
          onPhase={setPhase}
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

interface PlayableHomeProps {
  user: Session['user'] | null
  authProvider: Session['authProvider'] | null
  localDemo?: boolean
  localCodex?: boolean
}

const phaseNames: Partial<Record<PlayableTaskPhase, string>> = {
  draft: '需求整理',
  awaiting_confirmation: '等待确认',
  building: '构建中',
  validating: '验证中',
  reviewing: '等待验收',
  ready: '已交付',
  needs_plugin: '需要新增 Plugin',
  failed: '构建失败',
}

export function PlayableHome({ user, authProvider, localDemo = false, localCodex = false }: PlayableHomeProps) {
  const router = useRouter()
  const attachmentInput = useRef<HTMLInputElement>(null)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [tasks, setTasks] = useState<PlayableTaskSummary[]>([])
  const [loading, setLoading] = useState(Boolean(user))
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

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
      for (const file of attachments) {
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
    const accepted: File[] = []
    for (const file of Array.from(files)) {
      if (!referenceSlotForMimeType(file.type)) {
        setError('仅支持 PNG、JPEG、WebP、GIF、MP4 和 WebM 参考素材')
        continue
      }
      if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
        setError('单个参考素材不能超过 4 MiB')
        continue
      }
      accepted.push(file)
    }
    setAttachments((current) => [...current, ...accepted].slice(0, MAX_HOME_ATTACHMENTS))
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
        {localDemo || localCodex ? (
          <Badge variant="secondary">{localCodex ? '本地 Codex · 实际数据' : '本地演示 · 重启后清空'}</Badge>
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
              <ul className="mb-2 flex flex-wrap gap-2 px-1" aria-label="已选择的参考素材">
                {attachments.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    className="bg-muted flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                  >
                    {file.type.startsWith('video/') ? (
                      <FileVideo className="size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <FileImage className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="max-w-44 truncate">{file.name}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-5"
                      aria-label={`移除参考素材 ${file.name}`}
                      disabled={creating}
                      onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
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
