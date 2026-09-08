export const playableResourceAssetSlots = [
  'tileFaces',
  'backgroundBoard',
  'animationEffects',
  'audio',
  'endCard',
] as const

export const playableReferenceAssetSlots = ['referenceImage', 'referenceVideo'] as const
export const playableAssetSlots = [...playableResourceAssetSlots, ...playableReferenceAssetSlots] as const

export type PlayableResourceAssetSlot = (typeof playableResourceAssetSlots)[number]
export type PlayableReferenceAssetSlot = (typeof playableReferenceAssetSlots)[number]
export type PlayableAssetSlot = (typeof playableAssetSlots)[number]

export const MAX_ASSET_BYTES = 4 * 1024 * 1024
export const MAX_HOME_ATTACHMENTS = 6

export const PLAYABLE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const PLAYABLE_AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'] as const
export const PLAYABLE_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const

const policies: Record<PlayableAssetSlot, readonly string[]> = {
  tileFaces: PLAYABLE_IMAGE_MIME_TYPES,
  backgroundBoard: PLAYABLE_IMAGE_MIME_TYPES,
  animationEffects: PLAYABLE_IMAGE_MIME_TYPES,
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
  return policies[slot].join(',')
}

export function isMimeTypeAllowedForSlot(slot: PlayableAssetSlot, mimeType: string): boolean {
  return policies[slot].includes(mimeType)
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
