import { zip, type Zippable } from 'fflate'
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES, MAX_EXPANDED_ARCHIVE_BYTES } from './asset-policy'
import { safeImportPath } from './import-path'

/** 保留文件夹相对路径并转成普通 ZIP 附件，复用服务端导入流程，避免破坏 HTML 和 Spine 引用。 */
export async function packageFolder(files: readonly File[]): Promise<File> {
  const selected: { file: File; path: string }[] = []
  const names = new Set<string>()
  let total = 0
  let root = ''
  for (const file of files) {
    let path: string
    try {
      path = safeImportPath(file.webkitRelativePath)
    } catch {
      throw new Error('文件夹包含无效路径，请重新选择文件夹')
    }
    const parts = path.split('/')
    if (parts.length < 2 || (root && root !== parts[0])) throw new Error('请一次选择一个文件夹')
    root = parts[0]
    if (parts.some((part) => part.startsWith('.') || part === '__MACOSX')) continue
    if (/\.(zip|rar|7z|tar|gz)$/i.test(path)) throw new Error('文件夹内含压缩包，请先解压后再上传')
    if (names.has(path.toLowerCase())) throw new Error('文件夹包含重名文件（不区分大小写）')
    names.add(path.toLowerCase())
    total += file.size
    if (total > MAX_EXPANDED_ARCHIVE_BYTES) throw new Error('文件夹原始文件合计不能超过 300 MiB')
    selected.push({ file, path })
    if (selected.length > MAX_ARCHIVE_ENTRIES) throw new Error('文件夹最多包含 1000 个文件')
  }
  if (!selected.length) throw new Error('文件夹内没有可上传的文件')
  // 所有文件通过数量和大小预检后才读取内容；无原型对象可安全容纳用户提供的路径键。
  const entries: Zippable = Object.create(null)
  for (const { file, path } of selected) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length !== file.size) throw new Error('读取文件夹失败，请重新选择')
    entries[path] = bytes
  }
  const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(entries, { level: 1 }, (error, data) => {
      if (error) reject(new Error('文件夹打包失败，请重新选择'))
      else resolve(new Uint8Array(data))
    })
  })
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('文件夹打包后不能超过 300 MiB')
  return new File([bytes], `${root}.zip`, { type: 'application/zip' })
}
