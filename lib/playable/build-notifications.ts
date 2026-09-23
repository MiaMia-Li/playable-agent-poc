export const BUILD_WATCH_EVENT = 'playable:watch-build'
export const BUILD_WATCH_KEY = 'playable:watched-builds'

// sessionStorage 负责刷新后恢复，自定义事件让当前标签页的全局监听器立即获知新增任务。
export function watchPlayableBuild(taskId: string) {
  try {
    sessionStorage.setItem(BUILD_WATCH_KEY, JSON.stringify([...new Set([...readWatchedBuilds(), taskId])]))
  } catch {
    /* 持久化失败仍发送事件，让当前页面以内存方式监听。 */
  }
  window.dispatchEvent(new CustomEvent(BUILD_WATCH_EVENT, { detail: taskId }))
}

export function readWatchedBuilds(): string[] {
  try {
    // 浏览器存储可能过期或被改写；过滤非字符串并限制恢复数量，避免无界轮询。
    const stored: unknown = JSON.parse(sessionStorage.getItem(BUILD_WATCH_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string').slice(0, 30) : []
  } catch {
    return []
  }
}
