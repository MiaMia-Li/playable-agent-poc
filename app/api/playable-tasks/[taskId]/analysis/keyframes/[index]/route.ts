import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

type RouteContext = { params: Promise<{ taskId: string; index: string }> }

export const GET = (request: NextRequest, context: RouteContext) =>
  playableTaskHandlers.analysisKeyframe(request, context)
