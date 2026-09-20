export const playableResourceAssetSlots = [
  'tileFaces',
  'backgroundBoard',
  'animationEffects',
  'audio',
  'endCard',
  'models',
] as const

export const playableReferenceAssetSlots = ['referenceImage', 'referenceVideo'] as const
export const playableAssetSlots = [
  ...playableResourceAssetSlots,
  ...playableReferenceAssetSlots,
  'sourceHtml',
  'assetPackage',
  'spine',
] as const

export type PlayableResourceAssetSlot = (typeof playableResourceAssetSlots)[number]
export type PlayableReferenceAssetSlot = (typeof playableReferenceAssetSlots)[number]
export type PlayableAssetSlot = (typeof playableAssetSlots)[number]

export const MAX_ASSET_BYTES = 4 * 1024 * 1024
// 业务上限与请求体分流阈值分开维护；展开大小和条目数另行限制，避免小压缩包耗尽内存。
export const MAX_HTML_BYTES = 100 * 1024 * 1024
export const MAX_EXPANDED_ARCHIVE_BYTES = 300 * 1024 * 1024
// 文件夹会在浏览器中打包为 ZIP；压缩包与展开内容使用同一总预算，不再额外卡在 100 MiB。
export const MAX_ARCHIVE_BYTES = MAX_EXPANDED_ARCHIVE_BYTES
export const MAX_ARCHIVE_ENTRIES = 1000
export const MAX_SPINE_BYTES = 100 * 1024 * 1024
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
 * multipart 请求仅承载不超过 4 MiB 的文件，给平台的请求体限制预留表单开销。
 * 超过此阈值走存储直传；提高 HTML 等业务上限时不能同步提高这个阈值。
 */
export const MAX_FORM_UPLOAD_BYTES = 4 * 1024 * 1024
export const PLAYABLE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
// SVGs are playable resources, not raster Reference Images sent to vision models.
export const SVG_MIME_TYPE = 'image/svg+xml'
export const PLAYABLE_VISUAL_RESOURCE_MIME_TYPES = [...PLAYABLE_IMAGE_MIME_TYPES, SVG_MIME_TYPE] as const
export const PLAYABLE_AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'] as const
export const PLAYABLE_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const

export const GLB_MIME_TYPE = 'model/gltf-binary'
export const PLAYABLE_MODEL_SLOTS = ['models', 'tileFaces', 'backgroundBoard', 'animationEffects'] as const

export const ARCHIVE_MIME_TYPES = ['application/zip', 'application/vnd.rar'] as const
export const SPINE_MIME_TYPES = [
  'application/x-spine-atlas',
  'application/x-spine-skel',
  'application/x-spine-json',
  'application/x-spine-png',
] as const

/** 同批或已选附件含 Spine 元数据时，把 PNG 归入 Spine 资源，避免按参考图限制大小和用途。 */
export function normalizeAttachmentBatch(files: File[], hasSpine = false): File[] {
  const spine = hasSpine || files.some((file) => /\.(atlas|skel)$/i.test(file.name))
  return files.map((file) =>
    spine && /\.png$/i.test(file.name)
      ? new File([file], file.name, { type: 'application/x-spine-png', lastModified: file.lastModified })
      : file,
  )
}

export function assetSizeError(slot: PlayableAssetSlot): string {
  if (slot === 'referenceVideo') return '单个参考视频不能超过 100 MiB'
  if (slot === 'sourceHtml') return '单个 HTML 文件不能超过 100 MiB'
  if (slot === 'assetPackage') return '单个压缩包不能超过 300 MiB'
  if (slot === 'spine') return 'Spine 资源合计不能超过 100 MiB'
  return '单个参考素材不能超过 4 MiB'
}

/** Normalize file types that browsers leave empty or report with a generic MIME type. */
export function playableFileMimeType(file: { name: string; type: string }): string {
  if (/\.ogg$/i.test(file.name) && ['', 'application/octet-stream', 'application/ogg', 'audio/ogg'].includes(file.type))
    return 'audio/ogg'
  if (/\.svg$/i.test(file.name) && ['', 'application/octet-stream', SVG_MIME_TYPE].includes(file.type))
    return SVG_MIME_TYPE
  if (/\.glb$/i.test(file.name) && ['', 'application/octet-stream', GLB_MIME_TYPE].includes(file.type))
    return GLB_MIME_TYPE
  if (/\.html?$/i.test(file.name) && ['', 'application/octet-stream', 'text/html'].includes(file.type))
    return 'text/html'
  if (/\.zip$/i.test(file.name)) return 'application/zip'
  if (/\.rar$/i.test(file.name)) return 'application/vnd.rar'
  if (/\.atlas$/i.test(file.name)) return 'application/x-spine-atlas'
  if (/\.skel$/i.test(file.name)) return 'application/x-spine-skel'
  if (/\.json$/i.test(file.name)) return 'application/x-spine-json'
  return file.type
}

export function attachmentSlotForFile(file: { name: string; type: string }): PlayableAssetSlot | undefined {
  const mimeType = playableFileMimeType(file)
  if ((PLAYABLE_AUDIO_MIME_TYPES as readonly string[]).includes(mimeType)) return 'audio'
  if (mimeType === SVG_MIME_TYPE) return 'animationEffects'
  if ((ARCHIVE_MIME_TYPES as readonly string[]).includes(mimeType)) return 'assetPackage'
  if ((SPINE_MIME_TYPES as readonly string[]).includes(mimeType)) return 'spine'
  return mimeType === 'text/html'
    ? 'sourceHtml'
    : mimeType === GLB_MIME_TYPE
      ? 'models'
      : referenceSlotForMimeType(mimeType)
}

const policies: Record<PlayableAssetSlot, readonly string[]> = {
  assetPackage: ARCHIVE_MIME_TYPES,
  spine: SPINE_MIME_TYPES,
  sourceHtml: ['text/html'],
  models: [GLB_MIME_TYPE],
  tileFaces: [...PLAYABLE_VISUAL_RESOURCE_MIME_TYPES, GLB_MIME_TYPE],
  backgroundBoard: [...PLAYABLE_VISUAL_RESOURCE_MIME_TYPES, GLB_MIME_TYPE],
  animationEffects: [...PLAYABLE_VISUAL_RESOURCE_MIME_TYPES, GLB_MIME_TYPE],
  audio: PLAYABLE_AUDIO_MIME_TYPES,
  endCard: PLAYABLE_VISUAL_RESOURCE_MIME_TYPES,
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
  return [
    ...policies[slot],
    ...(policies[slot].includes(GLB_MIME_TYPE) ? ['.glb'] : []),
    ...(slot === 'audio' ? ['.ogg'] : []),
  ].join(',')
}

export function isMimeTypeAllowedForSlot(slot: PlayableAssetSlot, mimeType: string): boolean {
  return policies[slot].includes(mimeType)
}

export function maxAssetBytesForSlot(slot: PlayableAssetSlot): number {
  if (slot === 'sourceHtml') return MAX_HTML_BYTES
  if (slot === 'assetPackage') return MAX_ARCHIVE_BYTES
  if (slot === 'spine') return MAX_SPINE_BYTES
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

export const PLAYABLE_ATTACHMENT_ACCEPT = `${PLAYABLE_REFERENCE_ACCEPT},${PLAYABLE_AUDIO_MIME_TYPES.join(',')},.ogg,${SVG_MIME_TYPE},.svg,${GLB_MIME_TYPE},.glb,text/html,.html,.htm,.zip,.rar,.atlas,.skel,.json`

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
