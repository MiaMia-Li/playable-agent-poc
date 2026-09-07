import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  return playableTaskHandlers.confirm(request, context)
}
