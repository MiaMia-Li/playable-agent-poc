'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Clock3,
  Ellipsis,
  Globe2,
  Home,
  LayoutGrid,
  Loader2,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PlayableRecentTasksProvider, usePlayableRecentTasks, type PlayableTaskSummary } from './recent-tasks-context'

export type { PlayableTaskSummary } from './recent-tasks-context'

type StudioSection = 'home' | 'best-practices' | 'versions'

interface PlayableStudioShellProps {
  activeSection: StudioSection
  accountLabel: string
  children: React.ReactNode
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
  onNavigate,
}: Pick<PlayableStudioShellProps, 'activeSection' | 'accountLabel'> & { onNavigate?: () => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [renameTarget, setRenameTarget] = useState<PlayableTaskSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [savingRename, setSavingRename] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PlayableTaskSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const recentTasks = usePlayableRecentTasks()
  if (!recentTasks) throw new Error('Recent task context is unavailable')
  const isPublicExperience = accountLabel === '公开体验 · 任务共享'
  const { ensureLoaded, removeTask, renameTask, tasks } = recentTasks

  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

  const visibleTasks = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase()
    const matches = normalized
      ? tasks.filter((task) => (task.title || task.prompt).toLocaleLowerCase().includes(normalized))
      : tasks
    return matches.slice(0, 12)
  }, [searchQuery, tasks])

  function openRename(task: PlayableTaskSummary) {
    setRenameTarget(task)
    setRenameTitle(task.title || task.prompt)
    setRenameError('')
  }

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameTarget || savingRename) return
    const title = renameTitle.trim()
    if (!title) return
    setSavingRename(true)
    setRenameError('')
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(renameTarget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!response.ok) throw new Error('重命名失败，请重试')
      const body = (await response.json()) as { task: { id: string; title: string } }
      renameTask(body.task.id, body.task.title)
      setRenameTarget(null)
    } catch {
      setRenameError('重命名失败，请重试')
    } finally {
      setSavingRename(false)
    }
  }

  function openDelete(task: PlayableTaskSummary) {
    setDeleteTarget(task)
    setDeleteError('')
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const response = await fetch(`/api/playable-tasks/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('删除失败，请重试')
      removeTask(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setDeleteError('删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

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
                {group.tasks.map((task) => {
                  const taskLabel = task.title || task.prompt
                  return (
                    <div key={task.id} className="group relative">
                      <Link
                        href={`/tasks/${task.id}`}
                        onClick={onNavigate}
                        title={taskLabel}
                        className="hover:bg-foreground/[0.05] flex items-center gap-2 rounded-lg px-3 py-2 pr-11 text-sm transition-colors"
                      >
                        <span
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            task.hasArtifact ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                          )}
                          aria-label={task.hasArtifact ? '可试玩' : '进行中'}
                        />
                        <span className="min-w-0 flex-1 truncate">{taskLabel}</span>
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="absolute right-2 top-1/2 size-7 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                            aria-label={`管理“${taskLabel}”`}
                          >
                            <Ellipsis aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-36">
                          <DropdownMenuItem onSelect={() => openRename(task)}>
                            <Pencil aria-hidden="true" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => openDelete(task)}>
                            <Trash2 aria-hidden="true" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
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

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open && !savingRename) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void submitRename(event)}>
            <DialogHeader>
              <DialogTitle>重命名对话</DialogTitle>
              <DialogDescription>使用一个更容易识别的名称。</DialogDescription>
            </DialogHeader>
            <Input
              className="mt-5"
              aria-label="对话名称"
              value={renameTitle}
              maxLength={120}
              onChange={(event) => setRenameTitle(event.target.value)}
              autoFocus
            />
            {renameError && <p className="text-destructive mt-2 text-sm">{renameError}</p>}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={savingRename} onClick={() => setRenameTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={savingRename || !renameTitle.trim()}>
                {savingRename && <Loader2 className="animate-spin" aria-hidden="true" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个对话？</AlertDialogTitle>
            <AlertDialogDescription>删除后，它将从最近对话和作品库中隐藏。</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-destructive text-sm">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting && <Loader2 className="animate-spin" aria-hidden="true" />}
              删除对话
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PlayableStudioShellContent({ activeSection, accountLabel, children }: PlayableStudioShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="bg-background flex h-dvh min-h-0 overflow-hidden">
      <aside className="bg-muted/35 hidden w-72 shrink-0 border-r lg:block">
        <SidebarContent activeSection={activeSection} accountLabel={accountLabel} />
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

export function PlayableStudioShell(props: PlayableStudioShellProps) {
  const recentTasks = usePlayableRecentTasks()
  if (!recentTasks) {
    return (
      <PlayableRecentTasksProvider>
        <PlayableStudioShellContent {...props} />
      </PlayableRecentTasksProvider>
    )
  }
  return <PlayableStudioShellContent {...props} />
}
