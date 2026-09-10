'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, Eye, Loader2, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlayableStudioShell, type PlayableTaskSummary } from './studio-shell'

interface PlayableBuildSummary {
  id: string
  status: 'building' | 'failed' | 'succeeded'
  version: number | null
  current: boolean
  createdAt: string
  completedAt: string | null
}

interface VersionListItem extends PlayableBuildSummary {
  task: PlayableTaskSummary
}

export function VersionsPage({ accountLabel }: { accountLabel: string }) {
  const [versions, setVersions] = useState<VersionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    void fetch('/api/playable-tasks', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法加载版本库')
        return (await response.json()) as { tasks: PlayableTaskSummary[] }
      })
      .then(async ({ tasks }) => {
        const taskBuilds = await Promise.all(
          tasks
            .filter((task) => task.hasArtifact)
            .map(async (task) => {
              const response = await fetch(`/api/playable-tasks/${encodeURIComponent(task.id)}/versions`, {
                cache: 'no-store',
              })
              if (!response.ok) return []
              const body = (await response.json()) as { builds: PlayableBuildSummary[] }
              return body.builds
                .filter((build) => build.status === 'succeeded' && build.version !== null)
                .map((build) => ({ ...build, task }))
            }),
        )
        if (!active) return
        setVersions(
          taskBuilds
            .flat()
            .sort(
              (left, right) =>
                new Date(right.completedAt ?? right.createdAt).getTime() -
                new Date(left.completedAt ?? left.createdAt).getTime(),
            ),
        )
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '无法加载版本库')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const visibleVersions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return versions
    return versions.filter((item) => (item.task.title || item.task.prompt).toLocaleLowerCase().includes(normalized))
  }, [query, versions])

  return (
    <PlayableStudioShell activeSection="versions" accountLabel={accountLabel}>
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:pt-20 lg:pb-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            {/* <p className="text-muted-foreground text-sm">每一次成功生成，都沉淀为可继续创作的作品</p> */}
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">作品库</h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm sm:text-base">
              预览或下载任意 HTML 版本，也可以回到对应对话继续迭代。
            </p>
          </div>
          <Input
            className="w-full sm:w-72"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话或版本…"
            aria-label="搜索版本"
          />
        </div>

        {error && <p className="text-destructive mt-6 text-sm">{error}</p>}
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            正在加载版本…
          </div>
        ) : visibleVersions.length === 0 ? (
          <div className="mt-10 rounded-2xl border px-6 py-16 text-center">
            <p className="font-medium">还没有可展示的版本</p>
            <p className="text-muted-foreground mt-2 text-sm">完成一次试玩构建后，HTML 会出现在这里。</p>
          </div>
        ) : (
          <section className="mt-8 divide-y rounded-2xl border" aria-label="试玩版本列表">
            {visibleVersions.map((item) => {
              const taskTitle = item.task.title || item.task.prompt
              const taskUrl = `/tasks/${item.task.id}`
              const artifactUrl = `/api/playable-tasks/${encodeURIComponent(item.task.id)}/artifact?kind=playable&version=${encodeURIComponent(item.id)}`
              const downloadUrl = `${artifactUrl}&download=1`
              return (
                <article
                  key={item.id}
                  className="grid gap-5 p-5 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="bg-muted relative h-28 w-16 overflow-hidden rounded-xl border">
                    <iframe
                      title={`${taskTitle} v${item.version} 缩略预览`}
                      src={artifactUrl}
                      sandbox="allow-scripts"
                      tabIndex={-1}
                      className="pointer-events-none h-[640px] w-[360px] origin-top-left scale-[0.1778] border-0"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold">{taskTitle}</h2>
                      <span className="bg-muted rounded-full px-2 py-0.5 text-xs">v{item.version}</span>
                      {item.current && <span className="text-emerald-700 text-xs">当前版本</span>}
                    </div>
                    <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{item.task.prompt}</p>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {new Date(item.completedAt ?? item.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button asChild variant="outline" size="sm">
                      <a href={artifactUrl} target="_blank" rel="noopener noreferrer">
                        <Eye aria-hidden="true" />
                        预览作品
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={taskUrl}>
                        <MessageSquareText aria-hidden="true" />
                        回到对话
                      </Link>
                    </Button>
                    <Button asChild size="icon" variant="ghost">
                      <a href={downloadUrl} aria-label={`下载${taskTitle} v${item.version} HTML`}>
                        <Download aria-hidden="true" />
                      </a>
                    </Button>
                  </div>
                </article>
              )
            })}
          </section>
        )}
      </main>
    </PlayableStudioShell>
  )
}
