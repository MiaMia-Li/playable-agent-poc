import type { NextRequest } from 'next/server'
import { playableAssetEntryHandler } from '@/lib/playable/task-route-handlers'

type AssetRouteContext = { params: Promise<{ taskId: string; assetId: string }> }

export async function GET(request: NextRequest, context: AssetRouteContext) {
  return playableAssetEntryHandler(request, context)
}
