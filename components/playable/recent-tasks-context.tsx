'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { PlayableTaskPhase } from '@/lib/playable/schemas'

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

interface PlayableRecentTasksValue {
  tasks: PlayableTaskSummary[]
  ensureLoaded(): Promise<void>
  replaceTasks(tasks: PlayableTaskSummary[]): void
  addTask(task: PlayableTaskSummary): void
  renameTask(taskId: string, title: string): void
  removeTask(taskId: string): void
}

const PlayableRecentTasksContext = createContext<PlayableRecentTasksValue | null>(null)

export function PlayableRecentTasksProvider({
  children,
  initialTasks,
}: {
  children: React.ReactNode
  initialTasks?: PlayableTaskSummary[]
}) {
  const [tasks, setTasks] = useState<PlayableTaskSummary[]>(initialTasks ?? [])
  const loaded = useRef(initialTasks !== undefined)
  const pendingRequest = useRef<Promise<void> | null>(null)

  const ensureLoaded = useCallback(() => {
    if (loaded.current) return Promise.resolve()
    if (pendingRequest.current) return pendingRequest.current
    const request = fetch('/api/playable-tasks', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load recent conversations')
        return (await response.json()) as { tasks: PlayableTaskSummary[] }
      })
      .then((body) => {
        loaded.current = true
        setTasks(body.tasks)
      })
      .catch(() => undefined)
      .finally(() => {
        pendingRequest.current = null
      })
    pendingRequest.current = request
    return request
  }, [])

  const renameTask = useCallback((taskId: string, title: string) => {
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, title } : task)))
  }, [])

  const replaceTasks = useCallback((nextTasks: PlayableTaskSummary[]) => {
    loaded.current = true
    setTasks(nextTasks)
  }, [])

  const addTask = useCallback((task: PlayableTaskSummary) => {
    setTasks((current) => [task, ...current.filter((candidate) => candidate.id !== task.id)])
  }, [])

  const removeTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId))
  }, [])

  const value = useMemo(
    () => ({ tasks, ensureLoaded, replaceTasks, addTask, renameTask, removeTask }),
    [addTask, ensureLoaded, removeTask, renameTask, replaceTasks, tasks],
  )

  return <PlayableRecentTasksContext.Provider value={value}>{children}</PlayableRecentTasksContext.Provider>
}

export function usePlayableRecentTasks() {
  return useContext(PlayableRecentTasksContext)
}
