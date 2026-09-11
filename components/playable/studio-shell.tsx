'use client'

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Clock3,
  Ellipsis,
  Home,
  LayoutGrid,
  Loader2,
  Menu,
  MessageSquareText,
  PanelLeft,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PlayableRecentTasksProvider, usePlayableRecentTasks, type PlayableTaskSummary } from './recent-tasks-context'
import { StudioAccount } from './studio-account'

export type { PlayableTaskSummary } from './recent-tasks-context'

type StudioSection = 'home' | 'best-practices' | 'versions'

interface PlayableStudioShellProps {
  activeSection?: StudioSection
  accountLabel: string
  publicAccess?: boolean
  children: React.ReactNode
  /** `null` means the caller is loading tasks and the existing shared list should be preserved. */
  tasks?: PlayableTaskSummary[] | null
}

const navigation = [
  { id: 'home', href: '/', label: '首页', icon: Home },
  { id: 'best-practices', href: '/best-practices', label: '玩法模板', icon: LayoutGrid },
  { id: 'versions', href: '/versions', label: '构建记录', icon: Clock3 },
] as const

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'playable-studio-sidebar-collapsed'
let rememberedSidebarCollapsed = false

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
  publicAccess,
  collapsed = false,
  skipInitialLoad = false,
  onNavigate,
  onToggleCollapsed,
}: Pick<PlayableStudioShellProps, 'activeSection' | 'accountLabel' | 'publicAccess'> & {
  collapsed?: boolean
  skipInitialLoad?: boolean
  onNavigate?: () => void
  onToggleCollapsed?: () => void
}) {
  const pathname = usePathname()
  const currentSection =
    activeSection ??
    (pathname === '/best-practices'
      ? 'best-practices'
      : pathname === '/versions'
        ? 'versions'
        : pathname === '/'
          ? 'home'
          : undefined)
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
  const { ensureLoaded, removeTask, renameTask, tasks } = recentTasks

  useEffect(() => {
    if (skipInitialLoad) return
    void ensureLoaded()
  }, [ensureLoaded, skipInitialLoad])

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
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <div className={cn('pt-4', collapsed ? 'px-2' : 'px-3')}>
          <div className={cn('flex', collapsed ? 'flex-col items-center gap-2' : 'items-center justify-between')}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/"
                  className={cn('flex items-center font-semibold', collapsed ? 'justify-center' : 'gap-2 px-2')}
                  onClick={onNavigate}
                  aria-label={collapsed ? 'Playable Studio 首页' : undefined}
                >
                  <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Sparkles className="size-4" aria-hidden="true" />
                  </span>
                  {!collapsed && 'Playable Studio'}
                </Link>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" sideOffset={8}>
                  Playable Studio 首页
                </TooltipContent>
              )}
            </Tooltip>
            {onToggleCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-10 shrink-0"
                    aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                    aria-expanded={!collapsed}
                    onClick={onToggleCollapsed}
                  >
                    <PanelLeft className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {collapsed ? '展开侧栏' : '收起侧栏'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                size={collapsed ? 'icon' : 'default'}
                variant={collapsed ? 'ghost' : 'default'}
                className={cn('mt-5', collapsed ? 'mx-auto flex' : 'w-full justify-start gap-3')}
              >
                <Link href="/" onClick={onNavigate} aria-label={collapsed ? '新建试玩' : undefined}>
                  <Plus aria-hidden="true" />
                  {!collapsed && '新建试玩'}
                </Link>
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8}>
                新建试玩
              </TooltipContent>
            )}
          </Tooltip>

          {!collapsed && (
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
          )}
        </div>

        <nav aria-label="工作台导航" className={cn('mt-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
          {navigation.map((item) => {
            const Icon = item.icon
            const isActive = currentSection === item.id
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      'flex h-10 items-center rounded-lg text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                      isActive
                        ? 'bg-foreground/[0.07] text-foreground'
                        : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {!collapsed && item.label}
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" sideOffset={8}>
                    {item.label}
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}
        </nav>

        {!collapsed && <div className="mx-3 my-4 border-t" />}

        {collapsed ? (
          <div className="min-h-0 flex-1" />
        ) : (
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
                      const isCurrentTask = pathname === `/tasks/${task.id}`
                      return (
                        <div key={task.id} className="group relative">
                          <Link
                            href={`/tasks/${task.id}`}
                            prefetch={false}
                            onClick={onNavigate}
                            title={taskLabel}
                            aria-current={isCurrentTask ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-2 rounded-lg px-3 py-2 pr-11 text-sm transition-colors',
                              isCurrentTask ? 'bg-foreground/[0.07]' : 'hover:bg-foreground/[0.05]',
                            )}
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
        )}

        <div className={cn('border-t py-2', collapsed ? 'px-2' : 'px-3')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <StudioAccount accountLabel={accountLabel} publicAccess={publicAccess} compact={collapsed} />
              </div>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8}>
                {publicAccess ? '公开体验' : accountLabel}
              </TooltipContent>
            )}
          </Tooltip>
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
              <AlertDialogDescription>删除后，它将从最近对话和构建记录中隐藏。</AlertDialogDescription>
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
    </TooltipProvider>
  )
}

function PlayableStudioShellContent({
  activeSection,
  accountLabel,
  publicAccess = false,
  children,
  tasks: providedTasks,
}: PlayableStudioShellProps) {
  const pathname = usePathname()
  const isTaskWorkspace = pathname.startsWith('/tasks/')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(rememberedSidebarCollapsed)
  const recentTasks = usePlayableRecentTasks()
  const replaceTasks = recentTasks?.replaceTasks

  useEffect(() => {
    let storedCollapsed = false
    try {
      storedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      // Keep the default state when browser storage is unavailable.
    }
    rememberedSidebarCollapsed = storedCollapsed
    const syncStoredState = window.setTimeout(() => setSidebarCollapsed(storedCollapsed), 0)
    return () => window.clearTimeout(syncStoredState)
  }, [])

  useLayoutEffect(() => {
    if (!isTaskWorkspace) return
    const root = document.documentElement
    const body = document.body
    root.classList.remove('playable-task-scroll-lock')
    body.classList.remove('playable-task-scroll-lock')
    root.scrollTop = 0
    body.scrollTop = 0
    root.classList.add('playable-task-scroll-lock')
    body.classList.add('playable-task-scroll-lock')
    return () => {
      root.classList.remove('playable-task-scroll-lock')
      body.classList.remove('playable-task-scroll-lock')
    }
  }, [isTaskWorkspace])

  useEffect(() => {
    if (providedTasks !== undefined && providedTasks !== null) replaceTasks?.(providedTasks)
  }, [providedTasks, replaceTasks])

  function toggleSidebarCollapsed() {
    const nextCollapsed = !sidebarCollapsed
    rememberedSidebarCollapsed = nextCollapsed
    setSidebarCollapsed(nextCollapsed)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed))
    } catch {
      // The sidebar still works when browser storage is unavailable.
    }
  }

  return (
    <div
      className={cn('bg-background flex h-dvh min-h-0 overflow-hidden', isTaskWorkspace && 'fixed inset-0')}
      data-playable-task-workspace={isTaskWorkspace ? 'true' : undefined}
    >
      <aside
        className={cn(
          'bg-muted/35 hidden shrink-0 overflow-hidden border-r transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block',
          sidebarCollapsed ? 'w-16' : 'w-72',
        )}
      >
        <SidebarContent
          activeSection={activeSection}
          accountLabel={accountLabel}
          publicAccess={publicAccess}
          collapsed={sidebarCollapsed}
          skipInitialLoad={providedTasks !== undefined}
          onToggleCollapsed={toggleSidebarCollapsed}
        />
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
              publicAccess={publicAccess}
              skipInitialLoad={providedTasks !== undefined}
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
        <div className={cn('min-h-0 flex-1', isTaskWorkspace ? 'overflow-hidden' : 'overflow-auto')}>{children}</div>
      </div>
    </div>
  )
}

export function PlayableStudioShell(props: PlayableStudioShellProps) {
  const recentTasks = usePlayableRecentTasks()
  if (!recentTasks) {
    return (
      <PlayableRecentTasksProvider initialTasks={props.tasks === null ? [] : props.tasks}>
        <PlayableStudioShellContent {...props} />
      </PlayableRecentTasksProvider>
    )
  }
  return <PlayableStudioShellContent {...props} />
}
