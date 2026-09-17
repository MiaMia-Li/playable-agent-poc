import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = path.resolve('skills/_shared/assets/starter/work/test-freeform-playable.mjs')
const directories: string[] = []

const validHtml = (extra = '') =>
  `<meta name="viewport" content="width=device-width"><canvas></canvas>${extra}<script>
window.__PLAYABLE__={};addEventListener('message',e=>e.data==='playable:set-muted');
addEventListener('pointerdown',()=>{});function cta(){window.open('https://store.example')}
</script>`

async function check(html: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'freeform-check-'))
  directories.push(directory)
  const file = path.join(directory, 'output.html')
  await writeFile(file, html)
  return execFileAsync(process.execPath, [script, file])
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('test-freeform-playable.mjs', () => {
  it('passes an offline artifact whose script only mentions URLs in code', async () => {
    await expect(check(validHtml('<img src="data:image/png;base64,AAAA">'))).resolves.toMatchObject({
      stdout: expect.stringContaining('PASS'),
    })
  })

  it.each([
    ["Object.defineProperty(window,'__PLAYABLE__',{value:{}})"],
    ["window['__PLAYABLE__']={}"],
    ['globalThis.__PLAYABLE__={}'],
  ])('accepts the playable contract written as %s', async (contract) => {
    const html = validHtml().replace('window.__PLAYABLE__={};', `${contract};`)
    await expect(check(html)).resolves.toMatchObject({ stdout: expect.stringContaining('PASS') })
  })

  it('rejects an artifact that only mentions the contract name', async () => {
    const html = validHtml().replace('window.__PLAYABLE__={};', "const note='__PLAYABLE__';")
    await expect(check(html)).rejects.toMatchObject({ stderr: expect.stringContaining('playable contract is missing') })
  })

  it.each([
    ['a CDN script', '<script src="https://cdn.example/three.js"></script>', 'external resource in <script>'],
    ['an uploaded asset path', '<img src="user-assets/bg.png">', 'external resource in <img>'],
    ['a CSS url outside scripts', '<style>body{background:url(user-assets/bg.png)}</style>', 'external CSS url'],
    [
      'markup built inside a script',
      '<script>el.innerHTML=\'<img src="assets/coin.png">\'</script>',
      'external resource',
    ],
    ['a credential-shaped string', '<script>const id="sk-abcdefghijklmnopqrstuvwxyz"</script>', 'API key'],
  ])('rejects %s the platform would block at publish', async (_name, extra, message) => {
    await expect(check(validHtml(extra))).rejects.toMatchObject({ stderr: expect.stringContaining(message) })
  })
})
