import { open, stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { createReadStream, accessSync, statSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
export async function inspectFile(action, input) {
  if (action === 'header') {
    const file = await open(input, 'r')
    try {
      const bytes = Buffer.alloc(32),
        { bytesRead } = await file.read(bytes, 0, 32, 0)
      const hex = bytes.subarray(0, bytesRead).toString('hex')
      const type = hex.startsWith('89504e470d0a1a0a')
        ? 'png'
        : hex.startsWith('ffd8ff')
          ? 'jpeg'
          : hex.startsWith('504b0304')
            ? 'zip'
            : hex.startsWith('1f8b')
              ? 'gzip'
              : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
                ? 'webp'
                : 'unknown'
      return { bytes: (await file.stat()).size, headerHex: hex, detectedType: type }
    } finally {
      await file.close()
    }
  }
  if (action === 'hash') {
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(input)) hash.update(bytes)
    return { algorithm: 'sha256', digest: hash.digest('hex') }
  }
  if (action === 'json') {
    if ((await stat(input)).size > 16 * 1024 * 1024) throw new Error('JSON size limit')
    return JSON.parse(await readFile(input, 'utf8'))
  }
  throw new Error('Unknown operation')
}
/**
 * 单文件试玩里一行就可能是上兆的 base64，直接 sed、nl 或 cat 会把整份产物倒进工具输出。
 * 这里按行号取片段，超长行只保留开头并注明真实长度，读到的仍是可定位的源码。
 */
export const MAX_SLICE_LINES = 400
export function sliceSource(text, { from = 1, to, maxLine = 400 } = {}) {
  const lines = text.split('\n')
  const start = Math.max(1, Math.trunc(from) || 1)
  const requested = to === undefined ? start + MAX_SLICE_LINES - 1 : Math.trunc(to)
  const end = Math.min(lines.length, Math.max(start, requested), start + MAX_SLICE_LINES - 1)
  const out = []
  for (let number = start; number <= end; number++) {
    const line = lines[number - 1]
    out.push(
      line.length > maxLine
        ? `${number}\t${line.slice(0, maxLine)} … [line ${number} truncated: ${line.length} chars total]`
        : `${number}\t${line}`,
    )
  }
  const tail = end < lines.length ? `\n[stopped at line ${end}; ask for the next range]` : ''
  return `${lines.length} lines total; showing ${start}-${end}\n${out.join('\n')}${tail}`
}
/** 只回匹配点周围的片段，不回整行，避免命中 base64 行时把它整行打印出来。 */
export const MAX_SEARCH_MATCHES = 60
export function searchSource(text, pattern, { maxMatches = MAX_SEARCH_MATCHES, context = 120 } = {}) {
  const expression = new RegExp(pattern, 'gi')
  // 行首偏移表让每个匹配都能换算成行号和列号，不必对整份文本反复切片。
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1)
  const lineOf = (offset) => {
    let low = 0,
      high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (starts[middle] <= offset) low = middle
      else high = middle - 1
    }
    return low
  }
  const out = []
  let total = 0
  for (let match = expression.exec(text); match !== null; match = expression.exec(text)) {
    total++
    if (match[0].length === 0) expression.lastIndex++
    if (out.length >= maxMatches) continue
    const line = lineOf(match.index)
    // 片段不跨行，否则压缩空白后会把下一行的内容显示成同一处代码。
    const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
    const before = text.slice(Math.max(starts[line], match.index - context), match.index)
    const after = text.slice(match.index, Math.min(lineEnd, match.index + match[0].length + context))
    const snippet = `${before}${after}`.replace(/\s+/g, ' ')
    out.push(`${line + 1}:${match.index - starts[line] + 1}: ${snippet}`)
  }
  if (total === 0) return 'No match'
  const omitted = total > out.length ? `\n[${total - out.length} more matches omitted; narrow the pattern]` : ''
  return `${total} matches\n${out.join('\n')}${omitted}`
}
export function toolInventory() {
  const searchPaths = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const commands = Object.fromEntries(
    ['node', 'bash', 'python3', 'ffmpeg', 'ffprobe', 'jq', 'zip', 'unzip', 'xxd', 'rg', 'git'].map((command) => [
      command,
      searchPaths.some((directory) => {
        try {
          const file = path.join(directory, command)
          accessSync(file, constants.X_OK)
          return statSync(file).isFile()
        } catch {
          return false
        }
      }),
    ]),
  )
  return {
    version: 1,
    commands,
    builtins: ['fs', 'crypto', 'zlib', 'JSON'],
    policy:
      'Use Node built-ins for headers, JSON and hashes. An available command is not proof of supported flags. Do not install missing tools during a build.',
  }
}

async function readSource(input) {
  if (!input) throw new Error('Invalid paths')
  if ((await stat(input)).size > 16 * 1024 * 1024) throw new Error('Source size limit')
  return readFile(input, 'utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [action, input, target] = process.argv.slice(2)
    // 读源码的两个操作直接打印到 stdout：结果已按行数和匹配数限幅，不必再落文件。
    if (action === 'slice' || action === 'search') {
      const text = await readSource(input)
      const to = process.argv[5]
      console.log(
        action === 'slice'
          ? sliceSource(text, { from: Number(target ?? 1), ...(to === undefined ? {} : { to: Number(to) }) })
          : searchSource(text, target ?? ''),
      )
      process.exit(0)
    }
    const output = action === 'inventory' ? (input ?? 'sandbox-tools.json') : (target ?? 'work/file-inspection.json')
    if (action !== 'inventory' && (!input || path.resolve(input) === path.resolve(output)))
      throw new Error('Invalid paths')
    const result = action === 'inventory' ? toolInventory() : await inspectFile(action, input)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(result, null, 2))
    console.log('Node tool result saved')
  } catch {
    console.error('Node tool failed; check the operation and file')
    process.exitCode = 1
  }
}
