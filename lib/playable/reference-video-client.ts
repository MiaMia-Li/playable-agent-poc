import { MAX_REFERENCE_VIDEO_SECONDS, type PlayableAssetSlot } from './asset-policy'

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
 * Builds the multipart body for an asset upload, attaching the browser's
 * reading of a reference video's duration. Throws the user-facing message when
 * the video is over the limit, so no bytes are sent for a video that would be
 * refused anyway.
 */
export async function assetUploadForm(slot: PlayableAssetSlot, file: File): Promise<FormData> {
  const form = new FormData()
  form.set('slot', slot)
  form.set('file', file)
  if (slot === 'referenceVideo') {
    const duration = await readVideoDurationSeconds(file)
    if (duration !== null && duration > MAX_REFERENCE_VIDEO_SECONDS) throw new Error(REFERENCE_VIDEO_TOO_LONG_MESSAGE)
    if (duration !== null) form.set('durationSeconds', String(duration))
  }
  return form
}

/** The server repeats the duration check; its refusal gets the same message. */
export async function assetUploadErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status !== 413) return fallback
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
  return body?.error === 'Video too long' ? REFERENCE_VIDEO_TOO_LONG_MESSAGE : fallback
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
