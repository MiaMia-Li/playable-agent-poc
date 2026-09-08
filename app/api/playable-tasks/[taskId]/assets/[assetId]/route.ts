import type { NextRequest } from 'next/server'
import { playableAssetContentHandler, playableAssetDeleteHandler } from '@/lib/playable/task-route-handlers'

type AssetRouteContext = { params: Promise<{ taskId: string; assetId: string }> }

export async function GET(request: NextRequest, context: AssetRouteContext) {
  return playableAssetContentHandler(request, context)
}

export async function DELETE(request: NextRequest, context: AssetRouteContext) {
  return playableAssetDeleteHandler(request, context)
}
