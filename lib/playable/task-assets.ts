import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import { redactSecrets } from './redact'
import {
  isMimeTypeAllowedForSlot,
  isPlayableAssetSlot,
  maxAssetBytesForSlot,
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_SLOT,
  MAX_REFERENCE_VIDEO_SECONDS,
  MAX_TASK_ASSETS,
  MAX_UPLOAD_BYTES,
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
  /**
   * Reported by the browser, so trivially forgeable. That is acceptable: it
   * drives an upload guard and an evidence sanity check, neither of which is a
   * security boundary. Null when the container gave no finite duration.
   */
  durationSeconds: number | null
  storageKey: string
  createdAt: Date
}

export type SafePlayableAsset = Pick<
  PlayableAsset,
  'id' | 'slot' | 'filename' | 'mimeType' | 'size' | 'durationSeconds'
>

interface AssetHandlerDependencies {
  authenticate(request: NextRequest): Promise<string | undefined>
  findOwnedTask(taskId: string, userId: string): Promise<boolean>
  saveAsset(asset: PlayableAsset): Promise<void>
  listAssets(taskId: string, userId: string): Promise<PlayableAsset[]>
  /**
   * The newest reference video becomes the one analysis targets. Done here
   * rather than in the analysis route so the pointer is already correct when
   * the browser's follow-up request names the asset; otherwise a second video
   * uploaded in the same session would be refused as not active.
   */
  activateReferenceVideo(taskId: string, userId: string, assetId: string): Promise<void>
  store: ArtifactStore
  generateId(): string
}

type RouteContext = { params: Promise<{ taskId: string }> }
type AssetRouteContext = { params: Promise<{ taskId: string; assetId: string }> }

export function safeAsset(asset: PlayableAsset): SafePlayableAsset {
  const { id, slot, filename, mimeType, size, durationSeconds } = asset
  return { id, slot, filename, mimeType, size, durationSeconds }
}

/**
 * Parses the duration the browser reported alongside the upload.
 *
 * Returns null for anything unusable rather than rejecting. Some webm and
 * streamed mp4 containers report `Infinity` or `NaN` for `<video>.duration`,
 * and refusing a valid video because its metadata is awkward costs more than
 * letting one long video through a guard that is about experience, not safety.
 */
function parseUploadedDuration(value: FormDataEntryValue | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
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
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
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
    if (file.size <= 0 || file.size > maxAssetBytesForSlot(slot)) {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }
    const durationSeconds = slot === 'referenceVideo' ? parseUploadedDuration(form?.get('durationSeconds')) : null
    if (durationSeconds !== null && durationSeconds > MAX_REFERENCE_VIDEO_SECONDS) {
      return Response.json(
        { error: 'Video too long', maxDurationSeconds: MAX_REFERENCE_VIDEO_SECONDS },
        { status: 413 },
      )
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
      durationSeconds,
      storageKey,
      createdAt: new Date(),
    }
    await dependencies.store.put(storageKey, new Uint8Array(await file.arrayBuffer()), file.type)
    await dependencies.saveAsset(asset)
    if (slot === 'referenceVideo') await dependencies.activateReferenceVideo(taskId, userId, id)
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

interface AssetDeleteHandlerDependencies extends AssetAccessHandlerDependencies {
  /**
   * Clears the active pointer when it names the deleted video. It is not moved
   * to another remaining video: choosing one would silently decide which video
   * gets analysed and paid for, and how the user picks is still open.
   */
  releaseReferenceVideo(taskId: string, userId: string, assetId: string): Promise<void>
}

export function createPlayableAssetDeleteHandler(dependencies: AssetDeleteHandlerDependencies) {
  return async (request: NextRequest, context: AssetRouteContext) => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId, assetId } = await context.params
    const asset = await dependencies.findOwnedAsset(taskId, userId, assetId)
    if (!asset) return Response.json({ error: 'Not found' }, { status: 404 })
    await dependencies.store.delete(asset.storageKey)
    const deleted = await dependencies.deleteOwnedAsset(taskId, userId, assetId)
    if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 })
    if (deleted.slot === 'referenceVideo') await dependencies.releaseReferenceVideo(taskId, userId, assetId)
    return new Response(null, { status: 204 })
  }
}
