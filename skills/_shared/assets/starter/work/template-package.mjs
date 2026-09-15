import { readFile, writeFile, mkdir, lstat, realpath, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inflateRawSync, deflateRawSync } from 'node:zlib'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from './vendor/acorn.mjs'
import { decodeZip, encodeZip, safeResourcePath } from './zip-codec.mjs'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const limit = 32 * 1024 * 1024
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c')
function formats(html) {
  if (Buffer.byteLength(html) > limit) throw new Error('HTML size limit')
  const zip = /window\.__zip\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(html)
  if (zip) return { kind: 'cocos', zip, entries: decodeZip(Buffer.from(zip[1], 'base64')) }
  const tables = [
    ...html.matchAll(
      /<script\b[^>]*\bid=["'](__LAYA_(?:URL_MAP|BIN_DATA|TEXT_DATA|SCRIPT_DATA))["'][^>]*>([\s\S]*?)<\/script\s*>/g,
    ),
  ]
  if (!tables.some((t) => t[1] === '__LAYA_SCRIPT_DATA') || new Set(tables.map((t) => t[1])).size !== tables.length)
    throw new Error('Unsupported template packaging')
  return { kind: 'laya', tables }
}
function resources(format) {
  const result = []
  let total = 0
  const add = (entry) => {
    total += entry.data.length
    if (result.length >= 10000 || total > 128 * 1024 * 1024) throw new Error('Resource size limit')
    result.push(entry)
  }
  if (format.kind === 'cocos') {
    for (const [name, data] of format.entries)
      if (!name.endsWith('/')) add({ file: 'files/' + safeResourcePath(name), container: 'zip', key: name, data })
    const embedded = format.entries.get('__res')
    if (embedded)
      for (const [key, value] of Object.entries(JSON.parse(embedded))) {
        safeResourcePath(key)
        if (typeof value !== 'string') throw new Error('Unsupported embedded resource')
        const uri = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value)
        add({
          file: 'resources/' + key,
          container: 'res',
          key,
          mime: uri?.[1],
          data: uri ? Buffer.from(uri[2], 'base64') : Buffer.from(value),
        })
      }
  } else
    for (const table of format.tables) {
      for (const [key, value] of Object.entries(JSON.parse(table[2]))) {
        safeResourcePath(key)
        if (typeof value !== 'string') throw new Error('Unsupported Laya resource')
        if (table[1] === '__LAYA_URL_MAP') {
          const uri = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value)
          if (!uri) continue // Preserve aliases and URLs exactly; they are not binary payloads.
          add({
            file: 'url/' + key,
            container: table[1],
            key,
            mime: uri[1],
            data: Buffer.from(uri[2], 'base64'),
          })
        } else
          add({
            file: table[1].replace('__LAYA_', '').toLowerCase() + '/' + key,
            container: table[1],
            key,
            data: inflateRawSync(Buffer.from(value, 'base64'), { maxOutputLength: limit }),
          })
      }
    }
  if (result.length > 10000 || result.reduce((sum, item) => sum + item.data.length, 0) > 128 * 1024 * 1024)
    throw new Error('Resource size limit')
  return result
}
export async function unpackTemplate(input, directory) {
  const html = await readFile(input, 'utf8'),
    format = formats(html),
    items = resources(format)
  // A new directory prevents stale files and pre-existing symlink destinations.
  await mkdir(path.dirname(path.resolve(directory)), { recursive: true })
  await mkdir(directory)
  const manifest = { version: 1, kind: format.kind, sourceSha256: hash(html), files: [] }
  await writeFile(path.join(directory, 'source.html'), html)
  for (const { data, ...entry } of items) {
    const dest = path.join(directory, entry.file)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, data)
    manifest.files.push({ ...entry, sha256: hash(data) })
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
export async function packTemplate(directory, output) {
  const root = await realpath(directory),
    html = await readFile(path.join(root, 'source.html'), 'utf8')
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
  if (manifest.version !== 1 || hash(html) !== manifest.sourceSha256) throw new Error('Template base changed')
  const format = formats(html),
    items = resources(format)
  // Recompute destinations from the original source, never trust edited manifest paths.
  if (
    manifest.kind !== format.kind ||
    JSON.stringify(manifest.files) !==
      JSON.stringify(items.map(({ data, ...entry }) => ({ ...entry, sha256: hash(data) })))
  )
    throw new Error('Resource manifest changed')
  const changed = []
  for (const item of items) {
    const dest = path.join(root, item.file),
      resolved = await realpath(dest)
    if (!resolved.startsWith(root + path.sep) || !(await lstat(dest)).isFile() || (await lstat(dest)).size > limit)
      throw new Error('Unsafe resource file')
    const data = await readFile(dest)
    if (!data.equals(item.data)) {
      if (item.key.endsWith('.js')) parse(data.toString('utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
      if (item.key.endsWith('.json')) JSON.parse(data.toString('utf8'))
      changed.push({ ...item, data })
    }
  }
  let result = html
  if (changed.length && format.kind === 'cocos') {
    const resChanges = changed.filter((item) => item.container === 'res')
    if (resChanges.length && changed.some((item) => item.container === 'zip' && item.key === '__res'))
      throw new Error('Conflicting resource edits')
    for (const item of changed.filter((item) => item.container === 'zip')) format.entries.set(item.key, item.data)
    if (resChanges.length) {
      const embedded = JSON.parse(format.entries.get('__res'))
      for (const item of resChanges)
        embedded[item.key] = item.mime
          ? `data:${item.mime};base64,${item.data.toString('base64')}`
          : item.data.toString('utf8')
      format.entries.set('__res', Buffer.from(JSON.stringify(embedded)))
    }
    const start = format.zip.index + format.zip[0].indexOf(format.zip[1])
    result =
      html.slice(0, start) + encodeZip(format.entries).toString('base64') + html.slice(start + format.zip[1].length)
  } else if (changed.length) {
    const replacements = []
    for (const table of format.tables) {
      const edits = changed.filter((item) => item.container === table[1])
      if (!edits.length) continue
      const map = JSON.parse(table[2])
      for (const item of edits)
        map[item.key] = item.mime
          ? `data:${item.mime};base64,${item.data.toString('base64')}`
          : deflateRawSync(item.data).toString('base64')
      const start = table.index + table[0].indexOf('>') + 1
      replacements.push({ start, end: start + table[2].length, content: json(map) })
    }
    for (const entry of replacements.reverse())
      result = result.slice(0, entry.start) + entry.content + result.slice(entry.end)
  }
  formats(result) // Verify the emitted archive/tables before writing.
  if (path.resolve(output).startsWith(root + path.sep))
    throw new Error('Output must be outside the extracted workspace')
  await mkdir(path.dirname(path.resolve(output)), { recursive: true })
  const temporary = output + '.packing'
  await writeFile(temporary, result, { flag: 'wx' })
  await rename(temporary, output)
  return { changedFiles: changed.length, sha256: hash(result) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [action, input, output] = process.argv.slice(2)
    if (!input || !output || !['unpack', 'pack'].includes(action)) throw new Error('Invalid command')
    if (action === 'unpack') await unpackTemplate(input, output)
    else await packTemplate(input, output)
    console.log('Template package operation completed')
  } catch {
    console.error('Template package operation failed; check format, paths and manifest')
    process.exitCode = 1
  }
}
