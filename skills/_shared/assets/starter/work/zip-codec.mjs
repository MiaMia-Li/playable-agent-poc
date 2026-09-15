import { deflateRawSync, inflateRawSync } from 'node:zlib'
const MAX_TOTAL = 128 * 1024 * 1024
const MAX_ENTRY = 32 * 1024 * 1024
const table = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export const crc32 = (data) => {
  let crc = -1
  for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255]
  return (crc ^ -1) >>> 0
}
export function safeResourcePath(name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.startsWith('/') ||
    /[\\\x00-\x1f:]/.test(name) ||
    name.split('/').some((p) => p === '..' || p === '.')
  )
    throw new Error('Unsafe resource path')
  return name
}
export function decodeZip(buffer) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      eocd = i
      break
    }
  if (eocd < 0 || buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6)) throw new Error('Unsupported ZIP')
  const count = buffer.readUInt16LE(eocd + 10),
    size = buffer.readUInt32LE(eocd + 12)
  let cursor = buffer.readUInt32LE(eocd + 16),
    total = 0
  if (count > 5000 || cursor + size !== eocd) throw new Error('Unsupported ZIP')
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory')
    const flags = buffer.readUInt16LE(cursor + 8),
      method = buffer.readUInt16LE(cursor + 10)
    const packed = buffer.readUInt32LE(cursor + 20),
      unpacked = buffer.readUInt32LE(cursor + 24)
    const n = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32)
    const start = buffer.readUInt32LE(cursor + 42),
      attrs = buffer.readUInt32LE(cursor + 38)
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      ((attrs >>> 16) & 0xf000) === 0xa000 ||
      unpacked > MAX_ENTRY ||
      (total += unpacked) > MAX_TOTAL
    )
      throw new Error('Unsupported ZIP entry')
    const name = safeResourcePath(buffer.subarray(cursor + 46, cursor + 46 + n).toString('utf8'))
    if (entries.has(name) || start + 30 > buffer.length || buffer.readUInt32LE(start) !== 0x04034b50)
      throw new Error('Invalid ZIP entry')
    const localNameLength = buffer.readUInt16LE(start + 26),
      begin = start + 30 + localNameLength + buffer.readUInt16LE(start + 28)
    if (buffer.subarray(start + 30, start + 30 + localNameLength).toString('utf8') !== name || begin + packed > eocd)
      throw new Error('Invalid ZIP entry')
    const bytes = buffer.subarray(begin, begin + packed)
    const data = method === 8 ? inflateRawSync(bytes, { maxOutputLength: MAX_ENTRY }) : Buffer.from(bytes)
    if (data.length !== unpacked || crc32(data) !== buffer.readUInt32LE(cursor + 16))
      throw new Error('ZIP integrity failed')
    entries.set(name, data)
    cursor += 46 + n + extra + comment
  }
  if (cursor !== eocd) throw new Error('Invalid ZIP directory')
  return entries
}
export function encodeZip(entries) {
  const locals = [],
    directory = []
  let offset = 0,
    total = 0
  if (entries.size > 5000) throw new Error('Too many ZIP entries')
  for (const [name, data] of entries) {
    safeResourcePath(name)
    if (data.length > MAX_ENTRY || (total += data.length) > MAX_TOTAL) throw new Error('ZIP size limit')
    const filename = Buffer.from(name),
      compressed = deflateRawSync(data),
      crc = crc32(data)
    const local = Buffer.alloc(30),
      central = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, filename, compressed)
    directory.push(central, filename)
    offset += local.length + filename.length + compressed.length
  }
  const cd = Buffer.concat(directory),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.size, 8)
  end.writeUInt16LE(entries.size, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
