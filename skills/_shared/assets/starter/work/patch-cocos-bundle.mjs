import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { parse } from './vendor/acorn.mjs'

export function patchBundle(source, plan) {
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new Error('input_too_large')
  const sha256 = createHash('sha256').update(source).digest('hex')
  if (plan?.sourceSha256 !== sha256) throw new Error('source_changed')
  if (!Array.isArray(plan.patches) || !plan.patches.length || plan.patches.length > 100)
    throw new Error('invalid_patch_plan')
  parse(source, { ecmaVersion: 'latest' })
  let patched = source
  for (const change of plan.patches) {
    if (typeof change.before !== 'string' || !change.before || typeof change.after !== 'string')
      throw new Error('invalid_patch_plan')
    const parts = patched.split(change.before)
    if (parts.length !== 2) throw new Error('patch_match_not_unique')
    patched = parts[0] + change.after + parts[1]
    if (Buffer.byteLength(patched) > 2 * 1024 * 1024) throw new Error('output_too_large')
  }
  parse(patched, { ecmaVersion: 'latest' })
  return patched
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [input, planFile, output] = process.argv.slice(2)
    if (!input || !planFile || !output || path.resolve(input) === path.resolve(output)) throw new Error('invalid_paths')
    const patched = patchBundle(await readFile(input, 'utf8'), JSON.parse(await readFile(planFile, 'utf8')))
    // Write only after every replacement and the resulting syntax have passed.
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, patched)
    console.log('Cocos patch saved; re-embed and validate the actual artifact')
  } catch (error) {
    if (error.message === 'source_changed') console.error('Cocos patch rejected: source hash changed')
    else if (error.message === 'patch_match_not_unique')
      console.error('Cocos patch rejected: replacement must match exactly once')
    else console.error('Cocos patch rejected: invalid plan, syntax or file access')
    process.exitCode = 1
  }
}
