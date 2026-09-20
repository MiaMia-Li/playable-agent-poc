import { extractAssetArchive, safeImportPath } from './asset-archive'
import { spineAtlasPages, spineSkeletonInfo } from './spine-assets'
import { MAX_SPINE_BYTES } from './asset-policy'
import { inspectGlb, GLB_UPLOAD_ERROR } from './glb'
import { GLB_MIME_TYPE, SVG_MIME_TYPE, playableFileMimeType } from './asset-policy'
import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import { redactSecrets } from './redact'
import {
  isMimeTypeAllowedForSlot,
  isPlayableAssetSlot,
  maxAssetBytesForSlot,
  MAX_ASSET_BYTES,
  MAX_REFERENCE_VIDEO_SECONDS,
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

function refuseAggregateSize(currentAssets: PlayableAsset[], slot: PlayableAssetSlot, size = 0): Response | undefined {
  if (
    slot === 'spine' &&
    currentAssets.filter((asset) => asset.slot === 'spine').reduce((sum, asset) => sum + asset.size, size) >
      MAX_SPINE_BYTES
  )
    return Response.json({ error: 'Spine resources exceed 100 MiB' }, { status: 413 })
}

// 上传阶段校验单文件内容；Spine 的跨文件配套关系留到确认阶段检查，允许分批补齐。
async function validateImportUpload(slot: PlayableAssetSlot, mimeType: string, filename: string, bytes: Uint8Array) {
  if (slot === 'assetPackage') await extractAssetArchive(bytes, mimeType)
  if (slot !== 'spine') return
  safeImportPath(filename)
  if (filename.includes('/') || filename.length > 255 || redactSecrets(filename) !== filename)
    throw new Error('Invalid Spine filename')
  if (mimeType === 'application/x-spine-atlas') {
    if (!spineAtlasPages(bytes).length) throw new Error('Invalid Spine atlas')
  } else if (mimeType === 'application/x-spine-png') {
    if (!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('Invalid Spine PNG')
  } else {
    spineSkeletonInfo({ path: filename, bytes })
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
      refuseAggregateSize(await dependencies.listAssets(taskId, userId), slot, file.size)
    if (refusal) return refusal

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (mimeType === GLB_MIME_TYPE) {
      try {
        inspectGlb(bytes)
      } catch {
        return Response.json({ error: GLB_UPLOAD_ERROR }, { status: 415 })
      }
    }
    try {
      await validateImportUpload(slot, mimeType, file.name, bytes)
    } catch {
      return Response.json({ error: 'Invalid archive or Spine asset' }, { status: 415 })
    }
    const id = dependencies.generateId()
    const storageKey = assetStorageKey(userId, taskId, id)
    const asset: PlayableAsset = {
      id,
      taskId,
      userId,
      slot,
      filename:
        slot === 'spine'
          ? file.name
          : safeFilename(mimeType === GLB_MIME_TYPE && !/\.glb$/i.test(file.name) ? `${file.name}.glb` : file.name),
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
      refuseAggregateSize(await dependencies.listAssets(taskId, userId), slot, size)
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
      refuseAggregateSize(currentAssets, slot, stored.size)
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
    // 直传完成后重新读取存储中的实际字节，不能只信令牌请求的类型和大小；失败则清理对象。
    if (slot === 'assetPackage' || slot === 'spine') {
      try {
        const stream = await dependencies.store.get(storageKey)
        if (!stream) throw new Error('Missing import')
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
        if (bytes.length !== stored.size) throw new Error('Import size mismatch')
        await validateImportUpload(slot, stored.contentType, filename, bytes)
      } catch {
        await dependencies.store.delete(storageKey)
        return Response.json({ error: 'Invalid archive or Spine asset' }, { status: 415 })
      }
    }
    return recordAsset(dependencies, {
      id,
      taskId,
      userId,
      slot,
      filename:
        slot === 'spine'
          ? filename
          : safeFilename(
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
    // 用户源码与导入包仅提供下载，禁止在本站同源页面中直接执行上传的 HTML。
    return new Response(stream, {
      headers: {
        'Content-Type': ['sourceHtml', 'assetPackage', 'spine'].includes(asset.slot)
          ? 'application/octet-stream'
          : asset.mimeType,
        'Content-Disposition': ['sourceHtml', 'assetPackage', 'spine'].includes(asset.slot)
          ? inlineContentDisposition(asset.filename).replace(/^inline/, 'attachment')
          : inlineContentDisposition(asset.filename),
        ...(['sourceHtml', 'assetPackage', 'spine'].includes(asset.slot)
          ? { 'Content-Security-Policy': "sandbox; default-src 'none'" }
          : asset.mimeType === SVG_MIME_TYPE
            ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" }
            : {}),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
}

function importedEntryContentType(path: string): string | undefined {
  if (/\.svg$/i.test(path)) return SVG_MIME_TYPE
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg'
  if (/\.webp$/i.test(path)) return 'image/webp'
  if (/\.gif$/i.test(path)) return 'image/gif'
  if (/\.mp3$/i.test(path)) return 'audio/mpeg'
  if (/\.wav$/i.test(path)) return 'audio/wav'
  if (/\.ogg$/i.test(path)) return 'audio/ogg'
  if (/\.m4a$/i.test(path)) return 'audio/mp4'
  if (/\.mp4$/i.test(path)) return 'video/mp4'
  if (/\.glb$/i.test(path)) return GLB_MIME_TYPE
}

/** Read-only preview for one allowlisted media entry inside an owned folder/archive upload. */
export function createPlayableAssetEntryHandler(dependencies: AssetAccessHandlerDependencies) {
  return async (request: NextRequest, context: AssetRouteContext) => {
    const userId = await dependencies.authenticate(request)
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { taskId, assetId } = await context.params
    const asset = await dependencies.findOwnedAsset(taskId, userId, assetId)
    if (!asset || asset.slot !== 'assetPackage') return Response.json({ error: 'Not found' }, { status: 404 })
    const requested = request.nextUrl.searchParams.get('path')
    let entryPath: string
    try {
      if (!requested) throw new Error('Missing path')
      entryPath = safeImportPath(requested)
    } catch {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    const contentType = importedEntryContentType(entryPath)
    if (!contentType) return Response.json({ error: 'Unsupported preview' }, { status: 415 })
    const stream = await dependencies.store.get(asset.storageKey)
    if (!stream) return Response.json({ error: 'Not found' }, { status: 404 })
    try {
      const archive = new Uint8Array(await new Response(stream).arrayBuffer())
      if (archive.length !== asset.size) throw new Error('Archive size mismatch')
      const files = await extractAssetArchive(archive, asset.mimeType)
      const file = files.find((candidate) => candidate.path === entryPath)
      if (!file || file.bytes.length > MAX_ASSET_BYTES) return Response.json({ error: 'Not found' }, { status: 404 })
      const body = new Uint8Array(file.bytes.length)
      body.set(file.bytes)
      return new Response(body.buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': inlineContentDisposition(file.path.split('/').at(-1) ?? file.path),
          'Content-Security-Policy':
            contentType === SVG_MIME_TYPE
              ? "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"
              : "sandbox; default-src 'none'",
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return Response.json({ error: 'Unable to read archive entry' }, { status: 400 })
    }
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
