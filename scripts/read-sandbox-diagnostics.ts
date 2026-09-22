import { writeFile } from 'node:fs/promises'
import { PrivateVercelArtifactStore } from '../lib/playable/artifact-store'

async function main() {
  const [key, output] = process.argv.slice(2)
  if (!key?.endsWith('/sandbox-diagnostics.json') || !output) {
    throw new Error('Expected a sandbox diagnostics Blob key and a new local output filename')
  }
  const stream = await new PrivateVercelArtifactStore().get(key)
  if (!stream) throw new Error('Diagnostics not found')
  const text = await new Response(stream).text()
  await writeFile(output, text, { mode: 0o600, flag: 'wx' })
  console.log('Sandbox diagnostics downloaded')
}

void main().catch(() => {
  console.error('Unable to download Sandbox diagnostics; check credentials, Blob key and output filename')
  process.exitCode = 1
})
