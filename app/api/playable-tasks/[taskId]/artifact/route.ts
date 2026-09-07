import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  return playableTaskHandlers.artifact(request, context)
}
