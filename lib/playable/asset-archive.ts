import { fromBuffer, type ZipFile, type Entry } from 'yauzl'
import { createExtractorFromData } from 'node-unrar-js'
import { MAX_ARCHIVE_BYTES, MAX_EXPANDED_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES } from './asset-policy'
import { safeImportPath } from './import-path'
export { safeImportPath } from './import-path'
export { MAX_EXPANDED_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES } from './asset-policy'

export interface ImportedFile {
  path: string
  bytes: Uint8Array
}

function retained(name: string) {
  return !name.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')
}

// 先校验目录项声明的大小，再在读取时核对实际字节数；重复路径按大小写不敏感处理。
function entryBudget() {
  let total = 0
  let count = 0
  const names = new Set<string>()
  return (name: string, size: number) => {
    safeImportPath(name)
    const key = name.toLowerCase()
    if (
      names.has(key) ||
      ++count > MAX_ARCHIVE_ENTRIES ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_ARCHIVE_BYTES ||
      (total += size) > MAX_EXPANDED_ARCHIVE_BYTES
    )
      throw new Error('Package limits exceeded')
    names.add(key)
    if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) throw new Error('Nested archives are unsupported')
  }
}

async function readZip(bytes: Uint8Array): Promise<ImportedFile[]> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, file) => (error || !file ? reject(new Error('Invalid ZIP')) : resolve(file)),
    ),
  )
  const check = entryBudget()
  const files: ImportedFile[] = []
  return new Promise((resolve, reject) => {
    const fail = () => {
      zip.close()
      reject(new Error('Invalid or oversized ZIP'))
    }
    zip.on('error', fail)
    zip.on('end', () => resolve(files))
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        if (entry.generalPurposeBitFlag & 1 || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          throw new Error('Encrypted entries and links are unsupported')
        const directory = entry.fileName.endsWith('/')
        check(directory ? entry.fileName.slice(0, -1) : entry.fileName, entry.uncompressedSize)
        if (directory || !retained(entry.fileName)) {
          zip.readEntry()
          return
        }
        const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
          zip.openReadStream(entry, (err, stream) =>
            err || !stream ? rej(new Error('Invalid ZIP stream')) : res(stream),
          ),
        )
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of stream) {
          size += chunk.length
          if (size > entry.uncompressedSize || size > MAX_ARCHIVE_BYTES) throw new Error('ZIP size mismatch')
          chunks.push(Buffer.from(chunk))
        }
        if (size !== entry.uncompressedSize) throw new Error('ZIP size mismatch')
        files.push({ path: entry.fileName, bytes: Buffer.concat(chunks) })
        zip.readEntry()
      })().catch(fail)
    })
    zip.readEntry()
  })
}

async function readRar(bytes: Uint8Array): Promise<ImportedFile[]> {
  const extractor = await createExtractorFromData({ data: Uint8Array.from(bytes).buffer })
  const list = extractor.getFileList()
  if (list.arcHeader.flags.headerEncrypted || list.arcHeader.flags.volume) throw new Error('Unsupported RAR')
  const check = entryBudget()
  // 完整遍历并校验文件头后才解压，避免遇到非法条目之前就分配大块解压内存。
  for (const header of list.fileHeaders) {
    if (header.flags.encrypted) throw new Error('Encrypted RAR is unsupported')
    check(header.name.replace(/\/$/, ''), header.unpSize)
  }
  const files: ImportedFile[] = []
  let actual = 0
  for (const entry of extractor.extract().files) {
    if (!entry.extraction) continue
    if (
      entry.extraction.length !== entry.fileHeader.unpSize ||
      (actual += entry.extraction.length) > MAX_EXPANDED_ARCHIVE_BYTES
    )
      throw new Error('RAR size mismatch')
    if (retained(entry.fileHeader.name)) files.push({ path: entry.fileHeader.name, bytes: entry.extraction })
  }
  return files
}

export async function extractAssetArchive(bytes: Uint8Array, mimeType: string): Promise<ImportedFile[]> {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Archive size limit exceeded')
  const files =
    mimeType === 'application/zip'
      ? await readZip(bytes)
      : mimeType === 'application/vnd.rar'
        ? await readRar(bytes)
        : undefined
  if (!files?.length) throw new Error('Empty or unsupported archive')
  return files
}

/** 按根目录 index、唯一子目录 index、唯一 HTML 的顺序选入口；有歧义时交由确认流程提示。 */
export function packageHtmlEntry(files: ImportedFile[]): string | undefined {
  const html = files.filter((file) => /\.html?$/i.test(file.path)).map((file) => file.path)
  return (
    html.find((name) => /^index\.html?$/i.test(name)) ??
    (html.filter((name) => /(^|\/)index\.html?$/i.test(name)).length === 1
      ? html.find((name) => /(^|\/)index\.html?$/i.test(name))
      : undefined) ??
    (html.length === 1 ? html[0] : undefined)
  )
}
