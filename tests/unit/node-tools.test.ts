import { expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const { inspectFile, toolInventory } = await import(
  pathToFileURL(path.resolve('skills/_shared/assets/starter/work/node-tools.mjs')).href
)
it('uses Node for exact binary headers, file hashes and JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-tools-'))
  try {
    const file = path.join(root, 'file'),
      bytes = Buffer.from('89504e470d0a1a0a', 'hex')
    await writeFile(file, bytes)
    expect(await inspectFile('header', file)).toEqual({
      bytes: 8,
      headerHex: bytes.toString('hex'),
      detectedType: 'png',
    })
    expect(await inspectFile('hash', file)).toMatchObject({ digest: createHash('sha256').update(bytes).digest('hex') })
    await writeFile(file, '{"ready":true}')
    expect(await inspectFile('json', file)).toEqual({ ready: true })
    await writeFile(file, '{')
    await expect(inspectFile('json', file)).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('reports actual availability without requiring optional commands', () => {
  const inventory = toolInventory()
  expect(inventory.commands.node).toBe(true)
  expect(typeof inventory.commands.xxd).toBe('boolean')
  expect(inventory.builtins).toContain('crypto')
})
