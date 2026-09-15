import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const tools = path.resolve('skills/_shared/assets/starter/work')
const { inspectBundle, inspectFile } = await import(pathToFileURL(path.join(tools, 'inspect-cocos-bundle.mjs')).href)
const { patchBundle } = await import(pathToFileURL(path.join(tools, 'patch-cocos-bundle.mjs')).href)
const original = await readFile('tests/fixtures/cocos/wheel-initializer.txt', 'utf8')
const directories: string[] = []
const hash = (source: string) => createHash('sha256').update(source).digest('hex')
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('decodes the real wheel initializer without executing bundle or module code', () => {
  const report = inspectBundle(original + ';throw new Error("must not execute");')
  expect(report.status).toBe('supported')
  expect(report.offset).toBe(256)
  expect(Object.values(report.strings)).toContain('OnBtnStartRoll')
  expect(Object.values(report.strings)).toContain('TURN_TOTAL_ANGLE')
  expect(report.stringCount).toBe(Object.keys(report.strings).length)
  // Verify concrete positions against the independent original JS initializer in an isolated process below.
})

it('matches the original string mapping for the bundled, trusted initializer', async () => {
  const execute = promisify(execFile)
  const result = await execute(process.execPath, ['-e', original + ';process.stdout.write(JSON.stringify(a))'], {
    timeout: 2000,
  })
  const expected = JSON.parse(result.stdout)
  const report = inspectBundle(original)
  expect(Object.values(report.strings)).toEqual(expected)
})

it('rejects truncated syntax, unknown decoders and unresolvable rotations', () => {
  expect(() => inspectBundle(original.slice(0, -3))).toThrow('invalid_javascript')
  expect(() => inspectBundle('const a = [];')).toThrow('unsupported_structure')
  expect(() => inspectBundle(original.replace('c=c-0x100', 'c=unknown(c)'))).toThrow('unsupported_structure')
  expect(() => inspectBundle(original.replace('0xde3b6', '99999999999999'))).toThrow('rotation_not_resolved')
  expect(() => inspectBundle(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('input_too_large')
})

it('reuses exact-hash analysis and updates the latest pointer when switching versions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocos-tools-'))
  directories.push(root)
  const input = path.join(root, 'input.js'),
    output = path.join(root, 'analysis')
  await writeFile(input, original)
  expect((await inspectFile(input, output)).cached).toBe(false)
  expect((await inspectFile(input, output)).cached).toBe(true)
  await writeFile(input, original + '\n')
  expect((await inspectFile(input, output)).cached).toBe(false)
  await writeFile(input, original)
  expect((await inspectFile(input, output)).cached).toBe(true)
  expect(JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8')).sha256).toBe(hash(original))
  expect(await readFile(input, 'utf8')).toBe(original)
})

it('returns a readable diagnostic result for unsupported input but fails for missing files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocos-tools-'))
  directories.push(root)
  const input = path.join(root, 'input.js'),
    output = path.join(root, 'analysis')
  await writeFile(input, 'const unsupported = true;')
  await promisify(execFile)(process.execPath, [path.join(tools, 'inspect-cocos-bundle.mjs'), input, output])
  await expect(
    promisify(execFile)(process.execPath, [path.join(tools, 'inspect-cocos-bundle.mjs'), input + '.missing', output]),
  ).rejects.toMatchObject({ code: 1 })
  const pointer = JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8'))
  expect(pointer).toMatchObject({ status: 'unsupported', code: 'unsupported_structure' })
  expect(JSON.parse(await readFile(path.join(output, pointer.report), 'utf8'))).toMatchObject({
    status: 'unsupported',
    code: 'unsupported_structure',
  })
})

it('checks source hashes, unique replacements and final syntax before emitting patches', () => {
  const source = 'const duration = 4;'
  const plan = { sourceSha256: hash(source), patches: [{ before: 'duration = 4', after: 'duration = 2' }] }
  expect(patchBundle(source, plan)).toBe('const duration = 2;')
  expect(() => patchBundle(source + '\n', plan)).toThrow('source_changed')
  expect(() => patchBundle(source, { ...plan, patches: [{ before: 'missing', after: 'x' }] })).toThrow(
    'patch_match_not_unique',
  )
  expect(() => patchBundle(source, { ...plan, patches: [{ before: 'duration = 4', after: '(' }] })).toThrow()
  const duplicates = 'const a=1; const b=1;'
  expect(() =>
    patchBundle(duplicates, { sourceSha256: hash(duplicates), patches: [{ before: '=1', after: '=2' }] }),
  ).toThrow('patch_match_not_unique')
})

it('keeps source and prior output untouched when a patch plan fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocos-tools-'))
  directories.push(root)
  const input = path.join(root, 'input.js'),
    output = path.join(root, 'patched.js'),
    plan = path.join(root, 'plan.json')
  const source = 'const duration = 4;'
  await writeFile(input, source)
  await writeFile(output, 'previous output')
  await writeFile(
    plan,
    JSON.stringify({ sourceSha256: hash(source), patches: [{ before: 'duration = 4', after: '(' }] }),
  )
  await expect(
    promisify(execFile)(process.execPath, [path.join(tools, 'patch-cocos-bundle.mjs'), input, plan, output]),
  ).rejects.toMatchObject({ code: 1 })
  expect(await readFile(input, 'utf8')).toBe(source)
  expect(await readFile(output, 'utf8')).toBe('previous output')
})
