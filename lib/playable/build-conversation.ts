import type { BuildTimelineEvent } from './build-activity'

/** 用构建开始时间匹配此前最近的方案消息，重试仍归属于同一轮方案。 */
export function placeBuildRuns(
  messages: Array<{ id: string | number; role: string; createdAt?: string; confirmation?: unknown }>,
  events: BuildTimelineEvent[],
) {
  const runs: BuildTimelineEvent[][] = []
  for (const event of events) {
    if (event.type === 'build_started') runs.push([])
    if (runs.length) runs[runs.length - 1].push(event)
  }
  return runs.map((events, index) => {
    const start = Date.parse(events[0].createdAt ?? '')
    const owner = messages.findLast(
      (message) => message.role === 'assistant' && message.confirmation && Date.parse(message.createdAt ?? '') <= start,
    )
    // 没有可靠时间信息时保留在兜底区域，不能把旧记录错误挂到新方案上。
    return { events, ownerId: owner?.id, latest: index === runs.length - 1 }
  })
}
