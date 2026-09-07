import type { NextRequest } from 'next/server'
import { playableTaskHandlers } from '@/lib/playable/task-route-handlers'

export async function POST(request: NextRequest) {
  return playableTaskHandlers.create(request)
}
