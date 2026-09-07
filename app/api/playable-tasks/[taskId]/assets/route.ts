import type { NextRequest } from 'next/server'
import { playableAssetHandler } from '@/lib/playable/task-route-handlers'

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  return playableAssetHandler(request, context)
}
