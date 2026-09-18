import path from 'node:path'
import { MAX_SPINE_BYTES } from './asset-policy'
import { safeImportPath, type ImportedFile } from './asset-archive'

// 按导出版本的主、次版本选择固定运行时；需与共享打包脚本中的 spineVersions 同步。
export const SPINE_RUNTIME_VERSIONS = { '4.0': '4.0.31', '4.1': '4.1.56', '4.2': '4.2.120', '4.3': '4.3.13' } as const
export interface SpineGroup {
  skeleton: string
  atlas?: string
  textures: string[]
  version: string
  runtimeVersion?: string
  animations: string[]
  bytes: number
  issues: string[]
}

export function spineAtlasPages(bytes: Uint8Array): string[] {
  const text = new TextDecoder().decode(bytes).trim()
  return text
    .split(/\r?\n\s*\r?\n/)
    .map(
      (block) =>
        block
          .split(/\r?\n/)
          .find((line) => line.trim())
          ?.trim() ?? '',
    )
    .filter((name) => /\.png$/i.test(name))
    .map(safeImportPath)
}

function binaryVersion(bytes: Uint8Array): string {
  // Spine 4.x 二进制头先存 8 字节哈希，再存变长整数标记的版本字符串；长度包含空值偏移。
  let cursor = 8
  let length = 0
  let shift = 0
  while (cursor < bytes.length && shift < 35) {
    const byte = bytes[cursor++]
    length |= (byte & 127) << shift
    if (!(byte & 128)) break
    shift += 7
  }
  if (length < 2 || length > 32 || cursor + length - 1 > bytes.length) throw new Error('Invalid Spine binary header')
  const version = new TextDecoder().decode(bytes.subarray(cursor, cursor + length - 1))
  if (!/^\d+\.\d+\.\d+(?:[-\w.]*)$/.test(version)) throw new Error('Unsupported Spine binary header')
  return version
}

export function spineSkeletonInfo(file: ImportedFile): { version: string; animations: string[] } {
  if (/\.skel$/i.test(file.path)) return { version: binaryVersion(file.bytes), animations: [] }
  const json = JSON.parse(new TextDecoder().decode(file.bytes))
  if (!json || !Array.isArray(json.bones) || typeof json.skeleton?.spine !== 'string')
    throw new Error('Invalid Spine JSON')
  return { version: json.skeleton.spine, animations: Object.keys(json.animations ?? {}).slice(0, 200) }
}

export function inspectSpineGroups(files: ImportedFile[]): SpineGroup[] {
  const groups: SpineGroup[] = []
  for (const file of files) {
    if (!/\.(skel|json)$/i.test(file.path)) continue
    let info: ReturnType<typeof spineSkeletonInfo>
    try {
      info = spineSkeletonInfo(file)
    } catch {
      if (/\.skel$/i.test(file.path)) throw new Error('Invalid Spine skeleton')
      continue
    }
    const directory = path.posix.dirname(file.path)
    const atlases = files.filter(
      (candidate) => /\.atlas$/i.test(candidate.path) && path.posix.dirname(candidate.path) === directory,
    )
    // 优先匹配同目录同名 atlas；仅在候选唯一时回退，避免多个角色串用贴图。
    const atlas =
      atlases.find(
        (candidate) => candidate.path.replace(/\.atlas$/i, '') === file.path.replace(/\.(skel|json)$/i, ''),
      ) ?? (atlases.length === 1 ? atlases[0] : undefined)
    const textures = atlas
      ? spineAtlasPages(atlas.bytes).map((name) => safeImportPath(path.posix.join(directory, name)))
      : []
    const versionKey = info.version.split('.').slice(0, 2).join('.') as keyof typeof SPINE_RUNTIME_VERSIONS
    const runtimeVersion = SPINE_RUNTIME_VERSIONS[versionKey]
    const issues: string[] = []
    if (!atlas) issues.push('缺少与骨骼文件配套的 atlas')
    if (atlas && !textures.length) issues.push('atlas 中没有可识别的 PNG 纹理页')
    if (textures.some((name) => !files.some((candidate) => candidate.path === name)))
      issues.push('atlas 引用的 PNG 纹理不完整')
    if (!runtimeVersion) issues.push('当前支持 Spine 4.0、4.1、4.2、4.3 导出版本，请重新导出匹配版本')
    const names = new Set([file.path, ...(atlas ? [atlas.path] : []), ...textures])
    const bytes = files
      .filter((candidate) => names.has(candidate.path))
      .reduce((sum, candidate) => sum + candidate.bytes.length, 0)
    if (bytes > MAX_SPINE_BYTES) issues.push('单组 Spine 资源不能超过 100 MiB')
    groups.push({ ...info, skeleton: file.path, atlas: atlas?.path, textures, runtimeVersion, bytes, issues })
  }
  return groups
}
