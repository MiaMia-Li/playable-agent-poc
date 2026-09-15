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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [action, input, target] = process.argv.slice(2)
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
