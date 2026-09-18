import { inspectGlb } from './glb.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const versions = { esbuild: '0.25.12', three: '0.165.0', '@dimforge/rapier3d-compat': '0.17.3' }
const marker = '<!-- PLAYABLE_SCRIPT -->'

export async function prepareRuntime(mode, root = process.cwd()) {
  if (!['2d', 'three', 'three-physics'].includes(mode)) throw new Error('Choose 2d, three or three-physics')
  const dependencies = { esbuild: versions.esbuild }
  if (mode !== '2d') dependencies.three = versions.three
  if (mode === 'three-physics') dependencies['@dimforge/rapier3d-compat'] = versions['@dimforge/rapier3d-compat']
  const directory = path.join(root, 'work/.playable-deps')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, dependencies }))
  // Keep registry output out of user-facing build logs. esbuild needs its installation script.
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: directory,
    stdio: 'pipe',
    timeout: 180000,
  })
}

export async function bundlePlayable({ entry, shell, output, root = process.cwd() }) {
  const resolve = (value) => path.resolve(root, value)
  const html = await readFile(resolve(shell), 'utf8')
  if (html.split(marker).length !== 2) throw new Error('HTML shell needs exactly one PLAYABLE_SCRIPT marker')
  if (resolve(output) === resolve(shell) || resolve(output) === resolve(entry))
    throw new Error('Keep source files separate from output')
  const dependencyRoot = path.join(root, 'work/.playable-deps')
  const require = createRequire(path.join(dependencyRoot, 'package.json'))
  const { build } = require('esbuild')
  const result = await build({
    absWorkingDir: root,
    entryPoints: [resolve(entry)],
    bundle: true,
    write: false,
    outfile: 'game.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    minify: true,
    treeShaking: true,
    legalComments: 'inline',
    metafile: true,
    logLevel: 'silent',
    nodePaths: [path.join(dependencyRoot, 'node_modules')],
    supported: { 'inline-script': true },
    loader: Object.fromEntries(
      ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.glb', '.mp3', '.ogg', '.wav', '.woff2', '.wasm'].map((ext) => [
        ext,
        'dataurl',
      ]),
    ),
    plugins: [
      {
        name: 'offline-imports',
        setup(builder) {
          builder.onLoad({ filter: /\.glb$/i }, async ({ path: filename }) => {
            const bytes = await readFile(filename)
            inspectGlb(bytes)
            return {
              contents: `export default ${JSON.stringify('data:model/gltf-binary;base64,' + bytes.toString('base64'))}`,
              loader: 'js',
            }
          })
          builder.onResolve({ filter: /^(?:https?:|\/\/)/ }, () => ({
            errors: [{ text: 'Remote imports are not allowed' }],
          }))
        },
      },
    ],
  })
  if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some((file) => file.imports.length)) {
    throw new Error('Bundle must contain one inline JavaScript file without external imports')
  }
  const licenses = []
  for (const name of Object.keys(versions)) {
    if (
      name === 'esbuild' ||
      !Object.keys(result.metafile.inputs).some(
        (file) => file.includes(`/node_modules/${name}/`) || file.startsWith(`node_modules/${name}/`),
      )
    )
      continue
    licenses.push(
      await readFile(
        name === '@dimforge/rapier3d-compat'
          ? new URL('./vendor/rapier.LICENSE', import.meta.url)
          : path.join(dependencyRoot, 'node_modules', name, 'LICENSE'),
        'utf8',
      ),
    )
  }
  const license = licenses.join('\n').replace(/<\/script/gi, '<\\/script')
  // Inline classic scripts execute at the marker, which can precede HUD/CTA nodes.
  // Guard the whole bundle (including top-level DOM queries), not just main().
  const script = `(function () {
    const start = function () { ${result.outputFiles[0].text}\n };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  })();`
  const artifact = html.replace(marker, () => `<script>/*\n${license.replace(/\*\//g, '* /')}\n*/\n${script}</script>`)
  await writeFile(resolve(output), artifact)
  const report = { bytes: Buffer.byteLength(artifact), inputs: Object.keys(result.metafile.inputs) }
  await mkdir(path.join(root, 'work'), { recursive: true })
  await writeFile(path.join(root, 'work/bundle-report.json'), JSON.stringify(report, null, 2))
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'prepare' && args.length === 1) await prepareRuntime(args[0])
    else if (command === 'build' && args.length === 3)
      await bundlePlayable({ entry: args[0], shell: args[1], output: args[2] })
    else throw new Error('Invalid bundle command')
    console.log('Playable bundle command completed')
  } catch {
    console.error('Playable bundle command failed; check dependencies, source imports and HTML marker')
    process.exitCode = 1
  }
}
