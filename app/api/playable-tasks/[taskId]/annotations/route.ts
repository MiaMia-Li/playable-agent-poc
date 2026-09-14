import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

type RouteContext = { params: Promise<{ taskId: string }> }

export const GET = (request: NextRequest, context: RouteContext) => playableTaskHandlers.annotations(request, context)

export const DELETE = (request: NextRequest, context: RouteContext) =>
  playableTaskHandlers.annotations(request, context)
