import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

export async function GET(request: NextRequest) {
  return playableTaskHandlers.library(request)
}
