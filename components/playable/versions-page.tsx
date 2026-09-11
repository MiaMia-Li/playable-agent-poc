'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, ExternalLink, Loader2, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlayableStudioShell, type PlayableTaskSummary } from './studio-shell'

interface PlayableValidationSummary {
  buildPassed: boolean
  deliveryCompliant: boolean
  bytes: number
}

interface PlayableDeliverySummary {
  label: string
  logicalWidth: number
  logicalHeight: number
  output: 'single-html'
}

interface PlayableBuildSummary {
  id: string
  status: 'building' | 'failed' | 'succeeded'
  version: number | null
  current: boolean
  delivery: PlayableDeliverySummary
  validation: PlayableValidationSummary | null
  createdAt: string
  completedAt: string | null
}

interface VersionListItem extends PlayableBuildSummary {
  task: PlayableTaskSummary
}

interface VersionResponseItem extends PlayableBuildSummary {
  taskId: string
}

function artifactUrl(item: VersionListItem) {
  return `/api/playable-tasks/${encodeURIComponent(item.task.id)}/artifact?kind=playable&version=${encodeURIComponent(item.id)}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function validationLabel(validation: PlayableValidationSummary | null) {
  if (!validation) return { label: '未校验', className: 'text-muted-foreground' }
  if (!validation.buildPassed) return { label: '校验异常', className: 'text-destructive' }
  if (!validation.deliveryCompliant) return { label: '体积超限', className: 'text-amber-700' }
  return { label: '校验通过', className: 'text-emerald-700' }
}

export function VersionsPage({ accountLabel, publicAccess = false }: { accountLabel: string; publicAccess?: boolean }) {
  const [tasks, setTasks] = useState<PlayableTaskSummary[] | null>(null)
  const [versions, setVersions] = useState<VersionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    void fetch('/api/playable-tasks/library', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法加载版本库')
        return (await response.json()) as { tasks: PlayableTaskSummary[]; versions: VersionResponseItem[] }
      })
      .then(({ tasks: loadedTasks, versions: loadedVersions }) => {
        if (!active) return
        const tasksById = new Map(loadedTasks.map((task) => [task.id, task]))
        setTasks(loadedTasks)
        setVersions(
          loadedVersions.flatMap((version) => {
            const task = tasksById.get(version.taskId)
            return task ? [{ ...version, task }] : []
          }),
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
    return versions.filter((item) => {
      const searchable = [item.id, item.task.title, item.task.prompt, item.delivery.label]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
      return searchable.includes(normalized)
    })
  }, [query, versions])

  return (
    <PlayableStudioShell activeSection="versions" accountLabel={accountLabel} publicAccess={publicAccess} tasks={tasks}>
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:pt-20 lg:pb-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">构建记录</h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm sm:text-base">
              查看每次成功构建的交付规格、校验结果和历史版本。
            </p>
          </div>
          <Input
            className="w-full sm:w-72"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索构建 ID…"
            aria-label="搜索构建记录"
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
            <p className="font-medium">还没有构建记录</p>
            <p className="text-muted-foreground mt-2 text-sm">完成一次试玩构建后，记录会出现在这里。</p>
          </div>
        ) : (
          <section className="mt-8 overflow-hidden rounded-2xl border" aria-label="构建记录列表">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-muted/40 text-muted-foreground border-b text-xs font-medium">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      构建 ID
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      交付规格
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      文件与校验
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      完成时间
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleVersions.map((item) => {
                    const taskUrl = `/tasks/${item.task.id}`
                    const playableUrl = artifactUrl(item)
                    const downloadUrl = `${playableUrl}&download=1`
                    const validation = validationLabel(item.validation)
                    return (
                      <tr key={item.id} aria-label={`构建 ${item.id}`} className="transition-colors hover:bg-muted/20">
                        <td className="px-5 py-4 align-middle">
                          <p className="text-sm font-medium">{item.id}</p>
                          {item.current && (
                            <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                              当前产物
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <p className="font-medium">{item.delivery.label}</p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {item.delivery.logicalWidth} × {item.delivery.logicalHeight} · 单文件 HTML
                          </p>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <p className="font-medium">{item.validation ? formatBytes(item.validation.bytes) : '—'}</p>
                          <p className={`mt-1 text-xs ${validation.className}`}>{validation.label}</p>
                        </td>
                        <td className="text-muted-foreground px-5 py-4 align-middle text-sm whitespace-nowrap">
                          {new Date(item.completedAt ?? item.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="flex justify-end gap-2">
                            <Button asChild variant="outline" size="sm">
                              <a href={playableUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink aria-hidden="true" />
                                预览
                              </a>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                              <Link href={taskUrl}>
                                <MessageSquareText aria-hidden="true" />
                                回到对话
                              </Link>
                            </Button>
                            <Button asChild size="icon" variant="ghost">
                              <a href={downloadUrl} aria-label={`下载构建 ${item.id} HTML`}>
                                <Download aria-hidden="true" />
                              </a>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </PlayableStudioShell>
  )
}
