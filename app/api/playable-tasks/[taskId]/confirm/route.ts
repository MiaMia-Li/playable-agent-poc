import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

// PoC 沿用 after() 执行构建，其生命周期仍受本函数执行期限限制。
// 30 分钟需要 Vercel Pro 或 Enterprise，并启用 Fluid Compute；部署后生效。
export const maxDuration = 1800

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  return playableTaskHandlers.confirm(request, context)
}
