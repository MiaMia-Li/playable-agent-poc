'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { queueStorageKey, readQueuedRequirements, type QueuedRequirement } from '@/lib/playable/queued-requirements'

export function useQueuedRequirements(taskId: string) {
  const [queue, setQueue] = useState<QueuedRequirement[]>([])
  const [loadedTaskId, setLoadedTaskId] = useState<string>()
  const [storageError, setStorageError] = useState(false)
  // ref 作为同步快照，连续更新无需等待 React 重渲染，持久化与界面使用同一份队列。
  const current = useRef<QueuedRequirement[]>([])
  const currentTaskId = useRef(taskId)
  useEffect(() => {
    currentTaskId.current = taskId
    current.current = readQueuedRequirements(taskId)
    setQueue(current.current)
    setLoadedTaskId(taskId)
  }, [taskId])
  const updateQueue = useCallback(
    (update: (items: QueuedRequirement[]) => QueuedRequirement[]) => {
      // 旧任务的异步发送回调可能晚到，不能用它覆盖刚切换到的新任务队列。
      if (currentTaskId.current !== taskId) return
      const next = update(current.current)
      current.current = next
      setQueue(next)
      try {
        sessionStorage.setItem(queueStorageKey(taskId), JSON.stringify(next))
        setStorageError(false)
      } catch {
        setStorageError(true)
      }
    },
    [taskId],
  )
  // 新任务尚未恢复存储时隐藏旧队列，调用方也会据 loaded 暂停自动发送。
  return { queue: loadedTaskId === taskId ? queue : [], updateQueue, loaded: loadedTaskId === taskId, storageError }
}
