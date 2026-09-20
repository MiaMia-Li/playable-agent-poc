import { expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const { inspectFile, toolInventory, sliceSource, searchSource } = await import(
  pathToFileURL(path.resolve('skills/_shared/assets/starter/work/node-tools.mjs')).href
)

const embedded = `<!DOCTYPE html><html><head><title>t</title></head>
var ASSETS={"a.png":"data:image/png;base64,${'x'.repeat(1_700_000)}"};
function drawSelectedTubeGlow(ctx){ ctx.stroke() }
function tubeIsComplete(stack){ return true }`
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
it('keeps an embedded asset line out of the slice while still numbering the source', () => {
  const output = sliceSource(embedded, { from: 1, to: 4 })
  expect(output).toContain('3\tfunction drawSelectedTubeGlow(ctx){ ctx.stroke() }')
  expect(output).toContain('[line 2 truncated: 1700046 chars total]')
  // 整行 1.7MB 的产物在这里必须缩到千字节级，否则回传一次就要花掉几百秒。
  expect(output.length).toBeLessThan(2000)
})

it('caps the number of slice lines so one call cannot dump the file', () => {
  const output = sliceSource(Array.from({ length: 900 }, (_, index) => `line ${index + 1}`).join('\n'), { from: 1 })
  expect(output).toContain('showing 1-400')
  expect(output).toContain('ask for the next range')
  expect(output).not.toContain('line 401')
})

it('returns match context instead of whole lines and counts the omitted matches', () => {
  const output = searchSource(embedded, 'tubeIsComplete|base64')
  expect(output).toContain('2 matches')
  expect(output).toMatch(/^2:37: var ASSETS=/m)
  // 命中 base64 行时只回窗口内的片段，不回整行。
  expect(output.length).toBeLessThan(1000)
  expect(searchSource('a\na\na\n', 'a', { maxMatches: 2 })).toContain('[1 more matches omitted')
  expect(searchSource('nothing here', 'absent')).toBe('No match')
})

it('reports actual availability without requiring optional commands', () => {
  const inventory = toolInventory()
  expect(inventory.commands.node).toBe(true)
  expect(typeof inventory.commands.xxd).toBe('boolean')
  expect(inventory.builtins).toContain('crypto')
})
