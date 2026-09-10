'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock3, Globe2, Home, LayoutGrid, Menu, MessageSquareText, Plus, Search, Sparkles, X } from 'lucide-react'
import type { PlayableTaskPhase } from '@/lib/playable/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface PlayableTaskSummary {
  id: string
  prompt: string
  title?: string | null
  phase?: PlayableTaskPhase
  createdAt: string | null
  updatedAt?: string | null
  hasArtifact?: boolean
  artifactVersion?: string | null
  mode?: string | null
}

type StudioSection = 'home' | 'best-practices' | 'versions'

interface PlayableStudioShellProps {
  activeSection: StudioSection
  accountLabel: string
  children: React.ReactNode
  tasks?: PlayableTaskSummary[]
}

const navigation = [
  { id: 'home', href: '/', label: '首页', icon: Home },
  { id: 'best-practices', href: '/best-practices', label: '玩法模板', icon: LayoutGrid },
  { id: 'versions', href: '/versions', label: '作品库', icon: Clock3 },
] as const

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function groupTasks(tasks: PlayableTaskSummary[]) {
  const today = startOfToday().getTime()
  const lastWeek = today - 6 * 24 * 60 * 60 * 1000
  return [
    {
      label: '今天',
      tasks: tasks.filter((task) => new Date(task.updatedAt ?? task.createdAt ?? 0).getTime() >= today),
    },
    {
      label: '过去 7 天',
      tasks: tasks.filter((task) => {
        const timestamp = new Date(task.updatedAt ?? task.createdAt ?? 0).getTime()
        return timestamp < today && timestamp >= lastWeek
      }),
    },
    {
      label: '更早',
      tasks: tasks.filter((task) => new Date(task.updatedAt ?? task.createdAt ?? 0).getTime() < lastWeek),
    },
  ].filter((group) => group.tasks.length > 0)
}

function SidebarContent({
  activeSection,
  accountLabel,
  tasks: providedTasks,
  onNavigate,
}: Pick<PlayableStudioShellProps, 'activeSection' | 'accountLabel' | 'tasks'> & { onNavigate?: () => void }) {
  const [fetchedTasks, setFetchedTasks] = useState<PlayableTaskSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const isPublicExperience = accountLabel === '公开体验 · 任务共享'

  useEffect(() => {
    if (providedTasks !== undefined) return
    let active = true
    void fetch('/api/playable-tasks', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return { tasks: [] }
        return (await response.json()) as { tasks: PlayableTaskSummary[] }
      })
      .then((body) => {
        if (active) setFetchedTasks(body.tasks)
      })
      .catch(() => {
        if (active) setFetchedTasks([])
      })
    return () => {
      active = false
    }
  }, [providedTasks])

  const visibleTasks = useMemo(() => {
    const tasks = providedTasks ?? fetchedTasks
    const normalized = searchQuery.trim().toLocaleLowerCase()
    const matches = normalized
      ? tasks.filter((task) => (task.title || task.prompt).toLocaleLowerCase().includes(normalized))
      : tasks
    return matches.slice(0, 12)
  }, [fetchedTasks, providedTasks, searchQuery])

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-4">
        <Link href="/" className="flex items-center gap-2 px-2 font-semibold" onClick={onNavigate}>
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          Playable Studio
        </Link>
        <Button asChild className="mt-5 w-full justify-start gap-3">
          <Link href="/" onClick={onNavigate}>
            <Plus aria-hidden="true" />
            新建试玩
          </Link>
        </Button>
        <label className="relative mt-3 block">
          <Search
            className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索对话…"
            aria-label="搜索最近对话"
            className="bg-background h-9 pl-9"
          />
        </label>
      </div>

      <nav aria-label="工作台导航" className="mt-4 space-y-1 px-3">
        {navigation.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              aria-current={activeSection === item.id ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                activeSection === item.id
                  ? 'bg-foreground/[0.07] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="mx-3 my-4 border-t" />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="text-muted-foreground mb-3 flex items-center gap-2 px-2 text-xs font-medium">
          <MessageSquareText className="size-3.5" aria-hidden="true" />
          最近对话
        </div>
        {visibleTasks.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-xs">暂无匹配的对话</p>
        ) : (
          groupTasks(visibleTasks).map((group) => (
            <section key={group.label} className="mb-5">
              <h2 className="text-muted-foreground mb-1 px-2 text-[11px] font-medium">{group.label}</h2>
              <div className="space-y-0.5">
                {group.tasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    onClick={onNavigate}
                    title={task.title || task.prompt}
                    className="hover:bg-foreground/[0.05] flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors"
                  >
                    <span className="min-w-0 flex-1 truncate">{task.title || task.prompt}</span>
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        task.hasArtifact ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                      )}
                      aria-label={task.hasArtifact ? '可试玩' : '进行中'}
                    />
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="border-t px-3 py-2">
        <div className="flex h-9 items-center gap-2.5 rounded-lg px-2">
          {isPublicExperience ? (
            <span className="bg-background text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border">
              <Globe2 className="size-3.5" aria-hidden="true" />
            </span>
          ) : (
            <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
              {accountLabel.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{isPublicExperience ? '公开体验' : accountLabel}</span>
          {isPublicExperience && (
            <span className="text-muted-foreground bg-foreground/[0.06] rounded-full px-2 py-0.5 text-[10px]">
              共享
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function PlayableStudioShell({ activeSection, accountLabel, children, tasks }: PlayableStudioShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="bg-background flex h-dvh min-h-0 overflow-hidden">
      <aside className="bg-muted/35 hidden w-64 shrink-0 border-r lg:block">
        <SidebarContent activeSection={activeSection} accountLabel={accountLabel} tasks={tasks} />
      </aside>

      {mobileOpen && (
        <>
          <button
            className="fixed inset-0 z-40 bg-black/35 lg:hidden"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="bg-muted fixed inset-y-0 left-0 z-50 w-72 border-r lg:hidden">
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-2 top-2"
              aria-label="关闭导航"
              onClick={() => setMobileOpen(false)}
            >
              <X aria-hidden="true" />
            </Button>
            <SidebarContent
              activeSection={activeSection}
              accountLabel={accountLabel}
              tasks={tasks}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="bg-background flex h-14 shrink-0 items-center border-b px-4 lg:hidden">
          <Button size="icon" variant="ghost" aria-label="打开导航" onClick={() => setMobileOpen(true)}>
            <Menu aria-hidden="true" />
          </Button>
          <span className="ml-2 font-semibold">Playable Studio</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}
