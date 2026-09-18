export const playableResourceAssetSlots = [
  'tileFaces',
  'backgroundBoard',
  'animationEffects',
  'audio',
  'endCard',
  'models',
] as const

export const playableReferenceAssetSlots = ['referenceImage', 'referenceVideo'] as const
export const playableAssetSlots = [...playableResourceAssetSlots, ...playableReferenceAssetSlots] as const

export type PlayableResourceAssetSlot = (typeof playableResourceAssetSlots)[number]
export type PlayableReferenceAssetSlot = (typeof playableReferenceAssetSlots)[number]
export type PlayableAssetSlot = (typeof playableAssetSlots)[number]

export const MAX_ASSET_BYTES = 4 * 1024 * 1024
export const MAX_REFERENCE_VIDEO_BYTES = 100 * 1024 * 1024

/**
 * Not a cost limit — three minutes at high resolution is only about 52k tokens.
 * The blueprint's shape is what does not scale: at most 20 entities, 20 state
 * transitions, 8 controls. A twenty minute video forces the model to truncate
 * and produces a document that looks complete while missing half the game,
 * with nothing anywhere to say so.
 */
export const MAX_REFERENCE_VIDEO_SECONDS = 180
export const MAX_UPLOAD_BYTES = MAX_REFERENCE_VIDEO_BYTES
/**
 * Largest file the browser posts through the multipart route. Vercel refuses
 * function request bodies over 4.5 MB before the route runs, so anything
 * bigger is uploaded straight to storage instead.
 */
export const MAX_FORM_UPLOAD_BYTES = MAX_ASSET_BYTES
export const MAX_HOME_ATTACHMENTS = 6
export const MAX_ASSETS_PER_SLOT = 8
export const MAX_TASK_ASSETS = 30

export const PLAYABLE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const PLAYABLE_AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'] as const
export const PLAYABLE_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const

export const GLB_MIME_TYPE = 'model/gltf-binary'
export const PLAYABLE_MODEL_SLOTS = ['models', 'tileFaces', 'backgroundBoard', 'animationEffects'] as const

/** Browsers often leave GLB MIME empty or report application/octet-stream. */
export function playableFileMimeType(file: { name: string; type: string }): string {
  if (/\.glb$/i.test(file.name) && ['', 'application/octet-stream', GLB_MIME_TYPE].includes(file.type))
    return GLB_MIME_TYPE
  return file.type
}

export function attachmentSlotForFile(file: { name: string; type: string }): PlayableAssetSlot | undefined {
  const mimeType = playableFileMimeType(file)
  return mimeType === GLB_MIME_TYPE ? 'models' : referenceSlotForMimeType(mimeType)
}

const policies: Record<PlayableAssetSlot, readonly string[]> = {
  models: [GLB_MIME_TYPE],
  tileFaces: [...PLAYABLE_IMAGE_MIME_TYPES, GLB_MIME_TYPE],
  backgroundBoard: [...PLAYABLE_IMAGE_MIME_TYPES, GLB_MIME_TYPE],
  animationEffects: [...PLAYABLE_IMAGE_MIME_TYPES, GLB_MIME_TYPE],
  audio: PLAYABLE_AUDIO_MIME_TYPES,
  endCard: PLAYABLE_IMAGE_MIME_TYPES,
  referenceImage: PLAYABLE_IMAGE_MIME_TYPES,
  referenceVideo: PLAYABLE_VIDEO_MIME_TYPES,
}

export function isPlayableAssetSlot(value: string): value is PlayableAssetSlot {
  return playableAssetSlots.includes(value as PlayableAssetSlot)
}

export function isPlayableResourceAssetSlot(value: PlayableAssetSlot): value is PlayableResourceAssetSlot {
  return playableResourceAssetSlots.includes(value as PlayableResourceAssetSlot)
}

export function playableAssetAccept(slot: PlayableAssetSlot): string {
  return [...policies[slot], ...(policies[slot].includes(GLB_MIME_TYPE) ? ['.glb'] : [])].join(',')
}

export function isMimeTypeAllowedForSlot(slot: PlayableAssetSlot, mimeType: string): boolean {
  return policies[slot].includes(mimeType)
}

export function maxAssetBytesForSlot(slot: PlayableAssetSlot): number {
  return slot === 'referenceVideo' ? MAX_REFERENCE_VIDEO_BYTES : MAX_ASSET_BYTES
}

export function referenceSlotForMimeType(mimeType: string): PlayableReferenceAssetSlot | undefined {
  if (PLAYABLE_IMAGE_MIME_TYPES.includes(mimeType as (typeof PLAYABLE_IMAGE_MIME_TYPES)[number])) {
    return 'referenceImage'
  }
  if (PLAYABLE_VIDEO_MIME_TYPES.includes(mimeType as (typeof PLAYABLE_VIDEO_MIME_TYPES)[number])) {
    return 'referenceVideo'
  }
}

export const PLAYABLE_REFERENCE_ACCEPT = [...PLAYABLE_IMAGE_MIME_TYPES, ...PLAYABLE_VIDEO_MIME_TYPES].join(',')

export const PLAYABLE_ATTACHMENT_ACCEPT = `${PLAYABLE_REFERENCE_ACCEPT},${GLB_MIME_TYPE},.glb`

/** Keep all confirmation buttons and the server gate consistent. */
export function hasIncompatibleModelAssets(
  confirmation: {
    rendering?: { renderer: string }
    sourceTemplateId?: string | null
    resources: Partial<Record<PlayableResourceAssetSlot, { status: string }>>
  },
  assets: readonly { slot: PlayableAssetSlot; mimeType: string }[],
): boolean {
  return (
    assets.some(
      (asset) =>
        asset.mimeType === GLB_MIME_TYPE &&
        isPlayableResourceAssetSlot(asset.slot) &&
        confirmation.resources[asset.slot]?.status === '用户上传',
    ) &&
    (confirmation.rendering?.renderer !== 'threejs' || Boolean(confirmation.sourceTemplateId))
  )
}
