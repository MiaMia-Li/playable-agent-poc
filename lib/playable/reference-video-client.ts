import { put } from '@vercel/blob/client'
import { MAX_FORM_UPLOAD_BYTES, MAX_REFERENCE_VIDEO_SECONDS, type PlayableAssetSlot } from './asset-policy'
import type { SafePlayableAsset } from './task-assets'

/**
 * Browser-only helpers for the reference video upload path. The server keeps
 * the same duration limit, so these exist for the message the user sees, not
 * for enforcement.
 */

export const REFERENCE_VIDEO_TOO_LONG_MESSAGE = `参考视频不能超过 ${MAX_REFERENCE_VIDEO_SECONDS / 60} 分钟`

const DURATION_READ_TIMEOUT_MS = 5000

/**
 * Reads the duration from the file's metadata without loading the video.
 *
 * Resolves null rather than rejecting whenever no finite duration comes back.
 * Some webm and streamed mp4 containers report `Infinity` or `NaN`, and the
 * limit is a guard on experience, so an unreadable file is let through.
 */
export function readVideoDurationSeconds(file: File): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null)
  const video = document.createElement('video')
  // A type the browser cannot play never yields metadata, so waiting for it
  // would only burn the timeout. Test DOMs answer '' for every type as well.
  if (typeof video.canPlayType !== 'function' || !video.canPlayType(file.type)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    let settled = false
    const settle = (duration: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null)
    }
    const timeout = window.setTimeout(() => settle(null), DURATION_READ_TIMEOUT_MS)
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => settle(video.duration)
    video.onerror = () => settle(null)
    video.src = url
  })
}

export async function isReferenceVideoTooLong(file: File): Promise<boolean> {
  const duration = await readVideoDurationSeconds(file)
  return duration !== null && duration > MAX_REFERENCE_VIDEO_SECONDS
}

/**
 * The browser's reading of a reference video's duration. Throws the
 * user-facing message when the video is over the limit, so no bytes are sent
 * for a video that would be refused anyway.
 */
async function uploadDurationSeconds(slot: PlayableAssetSlot, file: File): Promise<number | null> {
  if (slot !== 'referenceVideo') return null
  const duration = await readVideoDurationSeconds(file)
  if (duration !== null && duration > MAX_REFERENCE_VIDEO_SECONDS) throw new Error(REFERENCE_VIDEO_TOO_LONG_MESSAGE)
  return duration
}

/** The server repeats the duration check; its refusal gets the same message. */
async function assetUploadErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status !== 413) return fallback
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
  return body?.error === 'Video too long' ? REFERENCE_VIDEO_TOO_LONG_MESSAGE : fallback
}

function isAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (cause instanceof Error && cause.name === 'AbortError')
}

/**
 * Sends the file straight to storage and then has the server record it.
 * Resolves undefined when the server has no direct uploads (local demo), so
 * the caller can use the multipart route instead.
 */
async function uploadDirect(
  assetsUrl: string,
  slot: PlayableAssetSlot,
  file: File,
  durationSeconds: number | null,
  fallbackMessage: string,
  signal: AbortSignal | undefined,
): Promise<SafePlayableAsset | undefined> {
  const tokenResponse = await fetch(`${assetsUrl}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, mimeType: file.type, size: file.size, durationSeconds }),
    signal,
  })
  if (tokenResponse.status === 501) return
  if (!tokenResponse.ok) throw new Error(await assetUploadErrorMessage(tokenResponse, fallbackMessage))
  const { pathname, clientToken } = (await tokenResponse.json()) as { pathname: string; clientToken: string }
  try {
    await put(pathname, file, {
      access: 'private',
      token: clientToken,
      contentType: file.type,
      multipart: true,
      abortSignal: signal,
    })
  } catch (cause) {
    if (isAbort(cause, signal)) throw cause
    throw new Error(fallbackMessage)
  }
  const completeResponse = await fetch(`${assetsUrl}/uploads/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, pathname, filename: file.name, durationSeconds }),
    signal,
  })
  if (!completeResponse.ok) throw new Error(await assetUploadErrorMessage(completeResponse, fallbackMessage))
  return ((await completeResponse.json()) as { asset: SafePlayableAsset }).asset
}

/**
 * Uploads one asset to a task and returns what the server recorded. Throws
 * an Error carrying the user-facing message on refusal or failure.
 */
export async function uploadPlayableAsset(
  taskId: string,
  slot: PlayableAssetSlot,
  file: File,
  options: { fallbackMessage: string; signal?: AbortSignal },
): Promise<SafePlayableAsset> {
  const assetsUrl = `/api/playable-tasks/${encodeURIComponent(taskId)}/assets`
  const durationSeconds = await uploadDurationSeconds(slot, file)
  if (file.size > MAX_FORM_UPLOAD_BYTES) {
    const asset = await uploadDirect(assetsUrl, slot, file, durationSeconds, options.fallbackMessage, options.signal)
    if (asset) return asset
  }
  const form = new FormData()
  form.set('slot', slot)
  form.set('file', file)
  if (durationSeconds !== null) form.set('durationSeconds', String(durationSeconds))
  const response = await fetch(assetsUrl, { method: 'POST', body: form, signal: options.signal })
  if (!response.ok) throw new Error(await assetUploadErrorMessage(response, options.fallbackMessage))
  return ((await response.json()) as { asset: SafePlayableAsset }).asset
}

/**
 * Starts analysis of a just-uploaded reference video. The asset is named so
 * that two uploads in quick succession each ask about their own video; the
 * route refuses one that is no longer active rather than analysing another.
 */
export async function requestReferenceVideoAnalysis(
  taskId: string,
  assetId: string,
  options: { rerun?: boolean } = {},
): Promise<Response> {
  return fetch(`/api/playable-tasks/${encodeURIComponent(taskId)}/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, ...(options.rerun ? { rerun: true } : {}) }),
  })
}
