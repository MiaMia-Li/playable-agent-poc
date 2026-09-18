import { inspectGlb, GLB_UPLOAD_ERROR } from './glb'
import { GLB_MIME_TYPE, playableFileMimeType } from './asset-policy'
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
function parseUploadedDuration(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

function assetStorageKey(userId: string, taskId: string, assetId: string): string {
  return `users/${userId}/tasks/${taskId}/assets/${assetId}`
}

function safeFilename(name: string): string {
  const filename = redactSecrets(name)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff._ -]/g, '_')
    .slice(0, 255)
  return filename || 'asset'
}

/** The checks every upload path applies to what it is about to store. */
function refuseAssetContent(input: {
  slot: PlayableAssetSlot
  mimeType: string
  size: number
  durationSeconds: number | null
}): Response | undefined {
  if (!isMimeTypeAllowedForSlot(input.slot, input.mimeType)) {
    return Response.json({ error: 'Unsupported media type' }, { status: 415 })
  }
  if (input.size <= 0 || input.size > maxAssetBytesForSlot(input.slot)) {
    return Response.json({ error: 'File too large' }, { status: 413 })
  }
  if (input.durationSeconds !== null && input.durationSeconds > MAX_REFERENCE_VIDEO_SECONDS) {
    return Response.json({ error: 'Video too long', maxDurationSeconds: MAX_REFERENCE_VIDEO_SECONDS }, { status: 413 })
  }
}

function refuseOverCapacity(currentAssets: PlayableAsset[], slot: PlayableAssetSlot): Response | undefined {
  if (currentAssets.length >= MAX_TASK_ASSETS) {
    return Response.json({ error: 'Too many assets' }, { status: 409 })
  }
  if (currentAssets.filter((asset) => asset.slot === slot).length >= MAX_ASSETS_PER_SLOT) {
    return Response.json({ error: 'Too many assets in slot' }, { status: 409 })
  }
}

async function recordAsset(dependencies: AssetHandlerDependencies, asset: PlayableAsset): Promise<Response> {
  await dependencies.saveAsset(asset)
  if (asset.slot === 'referenceVideo') await dependencies.activateReferenceVideo(asset.taskId, asset.userId, asset.id)
  return Response.json({ asset: safeAsset(asset) }, { status: 201 })
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
    const mimeType = playableFileMimeType(file)
    const durationSeconds = slot === 'referenceVideo' ? parseUploadedDuration(form?.get('durationSeconds')) : null
    const refusal =
      refuseAssetContent({ slot, mimeType, size: file.size, durationSeconds }) ??
      refuseOverCapacity(await dependencies.listAssets(taskId, userId), slot)
    if (refusal) return refusal

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (mimeType === GLB_MIME_TYPE) {
      try {
        inspectGlb(bytes)
      } catch {
        return Response.json({ error: GLB_UPLOAD_ERROR }, { status: 415 })
      }
    }
    const id = dependencies.generateId()
    const storageKey = assetStorageKey(userId, taskId, id)
    const asset: PlayableAsset = {
      id,
      taskId,
      userId,
      slot,
      filename: safeFilename(mimeType === GLB_MIME_TYPE && !/\.glb$/i.test(file.name) ? `${file.name}.glb` : file.name),
      mimeType,
      size: file.size,
      durationSeconds,
      storageKey,
      createdAt: new Date(),
    }
    await dependencies.store.put(storageKey, bytes, mimeType)
    return recordAsset(dependencies, asset)
  }
}

/**
 * Lets the browser send bytes straight to storage. Vercel refuses function
 * request bodies over 4.5 MB before the route runs, so a reference video
 * larger than that can never reach {@link createPlayableAssetHandler} once
 * deployed. Absent in local demo mode, where the multipart route has no such
 * limit and the browser falls back to it.
 */
export interface DirectAssetUploads {
  /** Issues a short-lived token that can only write `key`, with this type and at most this size. */
  issueUploadToken(key: string, constraints: { contentType: string; maxBytes: number }): Promise<string>
  /** What was actually stored, so the browser's account of its upload is never trusted. */
  describe(key: string): Promise<{ size: number; contentType: string } | undefined>
}

interface DirectAssetUploadDependencies extends AssetHandlerDependencies {
  directUploads?: DirectAssetUploads
}

function directUploadUnavailable(): Response {
  return Response.json({ error: 'Direct upload unavailable' }, { status: 501 })
}

/**
 * Admits a direct upload on the same terms as the multipart route and hands
 * back the key to write and a token scoped to it. The key is chosen here, so
 * the browser cannot place a blob outside this task.
 */
export function createPlayableAssetUploadTokenHandler(dependencies: DirectAssetUploadDependencies) {
  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId } = await context.params
    if (!(await dependencies.findOwnedTask(taskId, userId))) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    if (!dependencies.directUploads) return directUploadUnavailable()
    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
    const slot = body?.slot
    const mimeType = body?.mimeType
    const size = body?.size
    if (
      typeof slot !== 'string' ||
      !isPlayableAssetSlot(slot) ||
      typeof mimeType !== 'string' ||
      typeof size !== 'number'
    ) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    const durationSeconds = slot === 'referenceVideo' ? parseUploadedDuration(body?.durationSeconds) : null
    const refusal =
      refuseAssetContent({ slot, mimeType, size, durationSeconds }) ??
      refuseOverCapacity(await dependencies.listAssets(taskId, userId), slot)
    if (refusal) return refusal

    const pathname = assetStorageKey(userId, taskId, dependencies.generateId())
    const clientToken = await dependencies.directUploads.issueUploadToken(pathname, {
      contentType: mimeType,
      maxBytes: maxAssetBytesForSlot(slot),
    })
    return Response.json({ pathname, clientToken })
  }
}

/**
 * Records a direct upload once its bytes are in storage. Size and type come
 * from storage, not the request, and a blob that fails the checks is removed
 * rather than left orphaned.
 */
export function createPlayableAssetUploadCompleteHandler(dependencies: DirectAssetUploadDependencies) {
  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId } = await context.params
    if (!(await dependencies.findOwnedTask(taskId, userId))) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const directUploads = dependencies.directUploads
    if (!directUploads) return directUploadUnavailable()
    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
    const slot = body?.slot
    const pathname = body?.pathname
    const filename = body?.filename
    const prefix = assetStorageKey(userId, taskId, '')
    const id = typeof pathname === 'string' && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
    if (
      typeof slot !== 'string' ||
      !isPlayableAssetSlot(slot) ||
      typeof filename !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(id)
    ) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    const storageKey = assetStorageKey(userId, taskId, id)
    const currentAssets = await dependencies.listAssets(taskId, userId)
    const existing = currentAssets.find((asset) => asset.id === id)
    // A retried completion must not record the same blob twice.
    if (existing) return Response.json({ asset: safeAsset(existing) }, { status: 200 })

    const stored = await directUploads.describe(storageKey)
    if (!stored) return Response.json({ error: 'Upload not found' }, { status: 404 })
    const durationSeconds = slot === 'referenceVideo' ? parseUploadedDuration(body?.durationSeconds) : null
    const refusal =
      refuseAssetContent({ slot, mimeType: stored.contentType, size: stored.size, durationSeconds }) ??
      refuseOverCapacity(currentAssets, slot)
    if (refusal) {
      await dependencies.store.delete(storageKey)
      return refusal
    }
    if (stored.contentType === GLB_MIME_TYPE) {
      const stream = await dependencies.store.get(storageKey)
      try {
        if (!stream) throw new Error('Missing model')
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
        if (bytes.byteLength !== stored.size) throw new Error('Model size mismatch')
        inspectGlb(bytes)
      } catch {
        await dependencies.store.delete(storageKey)
        return Response.json({ error: GLB_UPLOAD_ERROR }, { status: 415 })
      }
    }
    return recordAsset(dependencies, {
      id,
      taskId,
      userId,
      slot,
      filename: safeFilename(
        stored.contentType === GLB_MIME_TYPE && !/\.glb$/i.test(filename) ? `${filename}.glb` : filename,
      ),
      mimeType: stored.contentType,
      size: stored.size,
      durationSeconds,
      storageKey,
      createdAt: new Date(),
    })
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
