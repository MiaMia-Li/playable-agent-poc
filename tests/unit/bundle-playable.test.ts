import { triangleGlb } from '../fixtures/glb'
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { JSDOM } = await import(pathToFileURL(createRequire(import.meta.url).resolve('jsdom')).href)

const { bundlePlayable } = await import(
  pathToFileURL(path.resolve('skills/_shared/assets/starter/work/bundle-playable.mjs')).href
)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(source: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playable-bundle-'))
  roots.push(root)
  const deps = path.join(root, 'work/.playable-deps/node_modules')
  await mkdir(deps, { recursive: true })
  const require = createRequire(import.meta.url)
  const esbuild = createRequire(require.resolve('tsx/package.json')).resolve('esbuild')
  await symlink(path.dirname(path.dirname(esbuild)), path.join(deps, 'esbuild'))
  await writeFile(path.join(root, 'game.js'), source)
  await writeFile(path.join(root, 'shell.html'), '<!doctype html><canvas></canvas><!-- PLAYABLE_SCRIPT -->')
  return { root, entry: 'game.js', shell: 'shell.html', output: 'output.html' }
}

it('embeds imported assets and modules in executable HTML without script breakout', async () => {
  const input = await fixture(
    `import image from './image.png'; import { value } from './state.js'; window.result = { image, value, text: '</script><script>window.injected=true</script>', literal: '$&' }`,
  )
  await writeFile(path.join(input.root, 'image.png'), Buffer.from([137, 80, 78, 71]))
  await writeFile(path.join(input.root, 'state.js'), 'export const value = 42')
  const report = await bundlePlayable(input)
  const html = await readFile(path.join(input.root, input.output), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }))
  expect(dom.window.result).toMatchObject({ value: 42, literal: '$&', image: 'data:image/png;base64,iVBORw==' })
  expect(dom.window.result.text).toBe('</script><script>window.injected=true</script>')
  expect(dom.window.injected).toBeUndefined()
  expect(dom.window.document.scripts).toHaveLength(1)
  expect(report.bytes).toBe(Buffer.byteLength(html))
  expect(await readFile(path.join(input.root, 'game.js'), 'utf8')).toContain('import image')
  dom.window.close()
})

it('rejects remote imports and split CSS output instead of shipping online dependencies', async () => {
  const input = await fixture(`import 'https://example.com/engine.js'`)
  await expect(bundlePlayable(input)).rejects.toThrow('Remote imports are not allowed')
  await writeFile(path.join(input.root, 'game.js'), `import './style.css'`)
  await writeFile(path.join(input.root, 'style.css'), 'canvas { color: red }')
  await expect(bundlePlayable(input)).rejects.toThrow('one inline JavaScript')
})

it('rejects ambiguous shells and source overwrites', async () => {
  const input = await fixture('window.ready = true')
  await expect(bundlePlayable({ ...input, output: input.entry })).rejects.toThrow('separate')
  await writeFile(path.join(input.root, input.shell), '<!-- PLAYABLE_SCRIPT --><!-- PLAYABLE_SCRIPT -->')
  await expect(bundlePlayable(input)).rejects.toThrow('exactly one')
})

it('initializes once after HUD and CTA nodes following the script marker exist', async () => {
  const input = await fixture(`
    window.boots = (window.boots || 0) + 1;
    const hud = document.getElementById('hud');
    document.getElementById('cta').addEventListener('click', () => { hud.textContent = 'clicked' });
    hud.textContent = 'ready';
  `)
  await writeFile(
    path.join(input.root, input.shell),
    '<!doctype html><body><canvas></canvas><!-- PLAYABLE_SCRIPT --><div id="hud">loading</div><button id="cta">Play</button></body>',
  )
  await bundlePlayable(input)
  const html = await readFile(path.join(input.root, input.output), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }))
  expect(dom.window.document.getElementById('hud')?.textContent).toBe('ready')
  dom.window.document.getElementById('cta')?.click()
  expect(dom.window.document.getElementById('hud')?.textContent).toBe('clicked')
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
  expect(dom.window.boots).toBe(1)
  dom.window.close()

  // The same bundle must also start when an embedding host injects it after load.
  const late = new JSDOM('<div id="hud"></div><button id="cta"></button>', { runScripts: 'outside-only' })
  await new Promise<void>((resolve) => late.window.addEventListener('load', () => resolve(), { once: true }))
  late.window.eval(new JSDOM(html).window.document.scripts[0].textContent || '')
  expect(late.window.boots).toBe(1)
  expect(late.window.document.getElementById('hud')?.textContent).toBe('ready')
  late.window.close()
})

it('embeds a real GLB with canonical MIME and rejects hidden external texture dependencies', async () => {
  const input = await fixture("import model from './block.glb'; window.model = model")
  const bytes = triangleGlb()
  await writeFile(path.join(input.root, 'block.glb'), bytes)
  await bundlePlayable(input)
  const html = await readFile(path.join(input.root, input.output), 'utf8')
  expect(html).toContain('data:model/gltf-binary;base64,' + Buffer.from(bytes).toString('base64'))
  await writeFile(
    path.join(input.root, 'block.glb'),
    triangleGlb((d) => {
      d.images = [{ uri: 'https://example.com/hidden.png' }]
    }),
  )
  await expect(bundlePlayable(input)).rejects.toThrow('self-contained GLB')
})
