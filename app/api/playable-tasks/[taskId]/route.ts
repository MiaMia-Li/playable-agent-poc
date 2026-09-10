import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

type RouteContext = { params: Promise<{ taskId: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  return playableTaskHandlers.rename(request, context)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return playableTaskHandlers.remove(request, context)
}
