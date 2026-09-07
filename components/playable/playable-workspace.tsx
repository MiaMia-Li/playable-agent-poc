'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, Plus, Sparkles } from 'lucide-react'
import type { Session } from '@/lib/session/types'
import type { ConfirmationProposal, PlayableTaskPhase } from '@/lib/playable/schemas'
import { User } from '@/components/auth/user'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ApiKeyDialog } from './api-key-dialog'
import { ChatWorkspace } from './chat-workspace'
import { PlayablePreview } from './playable-preview'

interface PlayableWorkspaceProps {
  taskId: string
  initialApiKeyConfigured?: boolean
  initialPrompt?: string
  initialPhase?: PlayableTaskPhase
  initialProposal?: ConfirmationProposal
}

export function PlayableWorkspace({
  taskId,
  initialApiKeyConfigured,
  initialPrompt,
  initialPhase = 'draft',
  initialProposal,
}: PlayableWorkspaceProps) {
  const [apiKeyConfigured, setApiKeyConfigured] = useState(initialApiKeyConfigured)
  const [keyDialogOpen, setKeyDialogOpen] = useState(initialApiKeyConfigured === false)
  const [phase, setPhase] = useState<PlayableTaskPhase>(initialPhase)
  const [proposal, setProposal] = useState(initialProposal)

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
    const poll = async () => {
      try {
        const response = await fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/events`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as { events?: Array<{ phase?: string }> }
        const next = [...(body.events ?? [])].reverse().find((event) => event.phase)?.phase
        if (
          active &&
          next &&
          ['draft', 'awaiting_confirmation', 'building', 'validating', 'ready', 'failed', 'cancelled'].includes(next)
        ) {
          setPhase(next as PlayableTaskPhase)
        }
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={requireApiKey}>
            API Key
          </Button>
          <User />
        </div>
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
        />
        <PlayablePreview taskId={taskId} phase={phase} />
      </div>
      <ApiKeyDialog
        open={keyDialogOpen}
        onOpenChange={(open) => {
          if (apiKeyConfigured) setKeyDialogOpen(open)
        }}
        onConfigured={() => {
          setApiKeyConfigured(true)
          setKeyDialogOpen(false)
        }}
      />
    </main>
  )
}

interface PlayableTaskSummary {
  id: string
  prompt: string
  title?: string | null
  repoUrl?: string | null
  phase?: PlayableTaskPhase
  createdAt: string
}

interface PlayableHomeProps {
  user: Session['user'] | null
  authProvider: Session['authProvider'] | null
}

const phaseNames: Partial<Record<PlayableTaskPhase, string>> = {
  draft: '需求整理',
  awaiting_confirmation: '等待确认',
  building: '构建中',
  validating: '验证中',
  ready: '可预览',
  failed: '构建失败',
}

export function PlayableHome({ user, authProvider }: PlayableHomeProps) {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [tasks, setTasks] = useState<PlayableTaskSummary[]>([])
  const [loading, setLoading] = useState(Boolean(user))
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    void fetch('/api/tasks', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('加载试玩列表失败')
        return (await response.json()) as { tasks: PlayableTaskSummary[] }
      })
      .then((body) => setTasks(body.tasks.filter((task) => !task.repoUrl)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : '加载试玩列表失败'))
      .finally(() => setLoading(false))
  }, [user])

  async function createPlayable() {
    const content = prompt.trim()
    if (!content || creating) return
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
      router.push(`/tasks/${body.task.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建试玩失败')
      setCreating(false)
    }
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
        <User user={user} authProvider={authProvider} />
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
            <div className="flex justify-end">
              <Button onClick={() => void createPlayable()} disabled={!user || !prompt.trim() || creating}>
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
