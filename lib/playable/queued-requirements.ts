import { z } from 'zod'

export const queuedRequirementSchema = z.object({
  id: z.string().max(100),
  content: z.string().trim().min(1).max(20000),
  baseBuildId: z.string().max(200),
  attachments: z.array(z.object({ id: z.string(), filename: z.string(), mimeType: z.string() })).max(20),
  status: z.enum(['pending', 'sending', 'failed']),
})
export type QueuedRequirement = z.infer<typeof queuedRequirementSchema>

// 按任务隔离当前标签页的草稿，跨任务导航时互不覆盖。
export function queueStorageKey(taskId: string) {
  return `playable:requirements:${taskId}`
}

export function readQueuedRequirements(taskId: string): QueuedRequirement[] {
  try {
    const result = z
      .array(queuedRequirementSchema)
      .max(20)
      .safeParse(JSON.parse(sessionStorage.getItem(queueStorageKey(taskId)) ?? '[]'))
    // 刷新前中断的请求可能已到达服务端，恢复时标为失败并等待显式重试，防止重复调用模型。
    return result.success
      ? result.data.map((item) => ({ ...item, status: item.status === 'sending' ? 'failed' : item.status }))
      : []
  } catch {
    return []
  }
}
