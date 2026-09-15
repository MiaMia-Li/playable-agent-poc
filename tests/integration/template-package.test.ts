import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const tool = path.resolve('skills/_shared/assets/starter/work')
const { unpackTemplate, packTemplate } = await import(pathToFileURL(path.join(tool, 'template-package.mjs')).href)
const { decodeZip, encodeZip, safeResourcePath } = await import(pathToFileURL(path.join(tool, 'zip-codec.mjs')).href)
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(id: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'template-package-'))
  roots.push(root)
  const source = `skills/${id.replaceAll('_', '-')}-playable/assets/templates/${id}/source.html`
  const directory = path.join(root, 'package'),
    output = path.join(root, 'output.html')
  const manifest = await unpackTemplate(source, directory)
  return { root, source, directory, output, manifest }
}
it.each(['dragon_slots', 'dragon_reward_wheel', 'zeus_scatter', 'balloon_master'])(
  'round trips %s exactly and changes only selected business script bytes',
  async (id) => {
    const { root, source, directory, output, manifest } = await setup(id)
    await packTemplate(directory, output)
    expect((await readFile(output)).equals(await readFile(source))).toBe(true)
    const script = manifest.files.find(
      (file: { file: string }) =>
        file.file === (id.startsWith('dragon') ? 'files/assets/main/index.js' : 'script_data/js/bundle.js'),
    )
    const original = await readFile(path.join(directory, script.file), 'utf8')
    await writeFile(path.join(directory, script.file), original + '\n/* targeted patch */')
    expect((await packTemplate(directory, output)).changedFiles).toBe(1)
    const roundTrip = path.join(root, 'verify')
    await unpackTemplate(output, roundTrip)
    for (const file of manifest.files)
      expect(
        (await readFile(path.join(roundTrip, file.file))).equals(await readFile(path.join(directory, file.file))),
      ).toBe(true)
  },
  30000,
)
it('re-embeds Cocos resource edits and rejects conflicting raw resource-table edits', async () => {
  const { root, directory, output, manifest } = await setup('dragon_reward_wheel')
  const resource = manifest.files.find(
    (file: { container: string; key: string }) => file.container === 'res' && file.key.endsWith('.js'),
  )
  await writeFile(
    path.join(directory, resource.file),
    (await readFile(path.join(directory, resource.file), 'utf8')) + '\n/* resource patch */',
  )
  await packTemplate(directory, output)
  await unpackTemplate(output, path.join(root, 'verify'))
  expect(await readFile(path.join(root, 'verify', resource.file))).toEqual(
    await readFile(path.join(directory, resource.file)),
  )
  await writeFile(path.join(directory, 'files/__res'), '{}')
  await expect(packTemplate(directory, output)).rejects.toThrow('Conflicting')
})
it('rejects unsafe paths, corruption and zip integrity failures', () => {
  for (const name of ['../secret', '/absolute', 'C:\\secret', 'a/../../secret', 'a\\secret'])
    expect(() => safeResourcePath(name)).toThrow()
  const archive = encodeZip(new Map([['a.txt', Buffer.from('valid')]]))
  expect(decodeZip(archive).get('a.txt').toString()).toBe('valid')
  const corrupted = Buffer.from(archive)
  corrupted[35] ^= 0xff
  expect(() => decodeZip(corrupted)).toThrow()
})
it('does not overwrite output for invalid JS, edited manifests or escaping symlinks', async () => {
  const { root, directory, output } = await setup('dragon_reward_wheel')
  const script = path.join(directory, 'files/assets/main/index.js')
  await writeFile(output, 'saved version')
  await writeFile(script, '(')
  await expect(packTemplate(directory, output)).rejects.toThrow()
  expect(await readFile(output, 'utf8')).toBe('saved version')
  await rm(script)
  await writeFile(path.join(root, 'outside.js'), 'const a=1;')
  await symlink(path.join(root, 'outside.js'), script)
  await expect(packTemplate(directory, output)).rejects.toThrow('Unsafe resource file')
})
