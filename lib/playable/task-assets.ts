import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import { redactSecrets } from './redact'
import {
  isMimeTypeAllowedForSlot,
  isPlayableAssetSlot,
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_SLOT,
  MAX_TASK_ASSETS,
  type PlayableAssetSlot,
} from './asset-policy'

export { MAX_ASSET_BYTES, playableAssetSlots } from './asset-policy'
export type { PlayableAssetSlot } from './asset-policy'

export interface PlayableAsset {
  id: string
  taskId: string
  userId: string
  slot: PlayableAssetSlot
  filename: string
  mimeType: string
  size: number
  storageKey: string
  createdAt: Date
}

export type SafePlayableAsset = Pick<PlayableAsset, 'id' | 'slot' | 'filename' | 'mimeType' | 'size'>

interface AssetHandlerDependencies {
  authenticate(request: NextRequest): Promise<string | undefined>
  findOwnedTask(taskId: string, userId: string): Promise<boolean>
  saveAsset(asset: PlayableAsset): Promise<void>
  listAssets(taskId: string, userId: string): Promise<PlayableAsset[]>
  store: ArtifactStore
  generateId(): string
}

type RouteContext = { params: Promise<{ taskId: string }> }
type AssetRouteContext = { params: Promise<{ taskId: string; assetId: string }> }

export function safeAsset(asset: PlayableAsset): SafePlayableAsset {
  const { id, slot, filename, mimeType, size } = asset
  return { id, slot, filename, mimeType, size }
}

export function createPlayableAssetHandler(dependencies: AssetHandlerDependencies) {
  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId } = await context.params
    if (!(await dependencies.findOwnedTask(taskId, userId))) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_ASSET_BYTES + 1024 * 1024) {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }
    const form = await request.formData().catch(() => undefined)
    const file = form?.get('file')
    const slot = form?.get('slot')
    if (!(file instanceof File) || typeof slot !== 'string' || !isPlayableAssetSlot(slot)) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    if (!isMimeTypeAllowedForSlot(slot, file.type)) {
      return Response.json({ error: 'Unsupported media type' }, { status: 415 })
    }
    if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }
    const currentAssets = await dependencies.listAssets(taskId, userId)
    if (currentAssets.length >= MAX_TASK_ASSETS) {
      return Response.json({ error: 'Too many assets' }, { status: 409 })
    }
    if (currentAssets.filter((asset) => asset.slot === slot).length >= MAX_ASSETS_PER_SLOT) {
      return Response.json({ error: 'Too many assets in slot' }, { status: 409 })
    }

    const id = dependencies.generateId()
    const storageKey = `users/${userId}/tasks/${taskId}/assets/${id}`
    const filename = redactSecrets(file.name)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff._ -]/g, '_')
      .slice(0, 255)
    const asset: PlayableAsset = {
      id,
      taskId,
      userId,
      slot,
      filename: filename || 'asset',
      mimeType: file.type,
      size: file.size,
      storageKey,
      createdAt: new Date(),
    }
    await dependencies.store.put(storageKey, new Uint8Array(await file.arrayBuffer()), file.type)
    await dependencies.saveAsset(asset)
    return Response.json({ asset: safeAsset(asset) }, { status: 201 })
  }
}

interface AssetAccessHandlerDependencies {
  authenticate(request: NextRequest): Promise<string | undefined>
  findOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined>
  deleteOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined>
  store: ArtifactStore
}

function inlineContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function createPlayableAssetContentHandler(dependencies: AssetAccessHandlerDependencies) {
  return async (request: NextRequest, context: AssetRouteContext) => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId, assetId } = await context.params
    const asset = await dependencies.findOwnedAsset(taskId, userId, assetId)
    if (!asset) return Response.json({ error: 'Not found' }, { status: 404 })
    const stream = await dependencies.store.get(asset.storageKey)
    if (!stream) return Response.json({ error: 'Not found' }, { status: 404 })
    return new Response(stream, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Disposition': inlineContentDisposition(asset.filename),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
}

export function createPlayableAssetDeleteHandler(dependencies: AssetAccessHandlerDependencies) {
  return async (request: NextRequest, context: AssetRouteContext) => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId, assetId } = await context.params
    const asset = await dependencies.findOwnedAsset(taskId, userId, assetId)
    if (!asset) return Response.json({ error: 'Not found' }, { status: 404 })
    await dependencies.store.delete(asset.storageKey)
    const deleted = await dependencies.deleteOwnedAsset(taskId, userId, assetId)
    if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 })
    return new Response(null, { status: 204 })
  }
}
