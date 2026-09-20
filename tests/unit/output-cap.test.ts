import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  installOutputCap,
  OUTPUT_CAP_MARKER,
  OUTPUT_CAP_SCRIPT,
  outputCapProfile,
  PLAYABLE_OUTPUT_CAP_BYTES,
} from '../../lib/playable/output-cap'

const run = promisify(execFile)

/** 本地起一个登录 shell 验收真实行为；沙盒里 Codex 也是用 /bin/bash -lc 执行命令。 */
async function withCappedShell<T>(capBytes: number, body: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'output-cap-'))
  try {
    const script = path.join(home, 'output-cap.mjs')
    await writeFile(script, OUTPUT_CAP_SCRIPT)
    await writeFile(path.join(home, '.bash_profile'), outputCapProfile(script, capBytes))
    return await body(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

async function login(home: string, command: string) {
  try {
    const { stdout, stderr } = await run('/bin/bash', ['-lc', command], {
      env: { ...process.env, HOME: home },
      maxBuffer: 8 * 1024 * 1024,
    })
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { exitCode: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

it('hands back only the capped prefix of an oversized dump', async () => {
  await withCappedShell(1024, async (home) => {
    const dump = path.join(home, 'playable.html')
    await writeFile(dump, 'a'.repeat(1_700_000))
    const result = await login(home, `cat ${JSON.stringify(dump)}`)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeLessThan(2000)
    expect(result.stdout).toContain('output capped at 1024 bytes')
    expect(result.stdout).toContain('node-tools.mjs slice')
  })
}, 30_000)

it('leaves small output, exit codes and stderr untouched', async () => {
  await withCappedShell(1024, async (home) => {
    const passed = await login(home, 'echo hello; echo world')
    expect(passed.stdout).toBe('hello\nworld\n')
    const failed = await login(home, 'echo out; echo bad >&2; exit 7')
    expect(failed.exitCode).toBe(7)
    expect(failed.stdout).toBe('out\n')
    expect(failed.stderr).toBe('bad\n')
  })
}, 30_000)

it('caps stderr on its own without losing it', async () => {
  await withCappedShell(1024, async (home) => {
    const result = await login(home, 'node -e "process.stderr.write(\'c\'.repeat(50000))"')
    expect(result.stderr.length).toBeLessThan(2000)
    expect(result.stderr).toContain('output capped at 1024 bytes')
  })
}, 30_000)

it('never truncates what a command writes to a file', async () => {
  await withCappedShell(1024, async (home) => {
    const target = path.join(home, 'output.html')
    const result = await login(home, `node -e "process.stdout.write('b'.repeat(200000))" > ${JSON.stringify(target)}`)
    expect(result.exitCode).toBe(0)
    expect((await readFile(target, 'utf8')).length).toBe(200_000)
  })
}, 30_000)

it('installs the guard for the agent shell without shadowing the image profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'output-cap-install-'))
  try {
    const home = path.join(root, 'home')
    await mkdir(home, { recursive: true })
    const written = new Map<string, string>()
    const sandbox = {
      defaultWorkingDirectory: '/vercel',
      run: async ({ command }: { command: string }) => ({
        exitCode: 0,
        stdout: command.includes('PLAYABLE_OUTPUT_CAP_ACTIVE') ? '1' : `${home}\n`,
      }),
      readTextFile: async ({ path: file }: { path: string }) => written.get(file) ?? null,
      writeTextFile: async ({ path: file, content }: { path: string; content: string }) => {
        written.set(file, content)
      },
    }
    expect(await installOutputCap(sandbox)).toBe(true)
    const profile = written.get(`${home}/.bash_profile`) ?? ''
    expect(profile).toContain(`. "${home}/.profile"`)
    expect(profile).toContain(OUTPUT_CAP_MARKER)
    expect(profile).toContain(`PLAYABLE_OUTPUT_CAP_BYTES=${PLAYABLE_OUTPUT_CAP_BYTES}`)
    // 工作区之外，Agent 清理 work/ 时不会把守卫删掉。
    expect(written.has('/vercel/.playable-tools/output-cap.mjs')).toBe(true)
    // 再次安装不叠加第二层重定向。
    expect(await installOutputCap(sandbox)).toBe(true)
    expect(profile.match(new RegExp(OUTPUT_CAP_MARKER, 'g'))).toHaveLength(1)
    expect(written.get(`${home}/.bash_profile`)).toBe(profile)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('keeps an existing profile and appends the guard after it', async () => {
  const written = new Map<string, string>([['/root/.bash_profile', 'export PATH=/custom:$PATH']])
  const sandbox = {
    defaultWorkingDirectory: '/vercel',
    run: async ({ command }: { command: string }) => ({
      exitCode: 0,
      stdout: command.includes('PLAYABLE_OUTPUT_CAP_ACTIVE') ? '1' : '/root',
    }),
    readTextFile: async ({ path: file }: { path: string }) => written.get(file) ?? null,
    writeTextFile: async ({ path: file, content }: { path: string; content: string }) => {
      written.set(file, content)
    },
  }
  expect(await installOutputCap(sandbox)).toBe(true)
  const profile = written.get('/root/.bash_profile') ?? ''
  expect(profile.startsWith('export PATH=/custom:$PATH\n')).toBe(true)
  expect(profile).toContain(OUTPUT_CAP_MARKER)
  expect(profile).not.toContain('.profile"; fi')
})

it('reports a failure instead of writing to an unknown home', async () => {
  const sandbox = {
    defaultWorkingDirectory: '/vercel',
    run: async () => ({ exitCode: 1, stdout: '' }),
    readTextFile: async () => null,
    writeTextFile: async () => {
      throw new Error('must not write')
    },
  }
  expect(await installOutputCap(sandbox)).toBe(false)
})

it('reports a failure when the agent login shell does not pick the guard up', async () => {
  const written = new Map<string, string>()
  const sandbox = {
    defaultWorkingDirectory: '/vercel',
    // Agent 的登录 shell 读到的 HOME 与宿主不同，文件写了也不会生效。
    run: async ({ command }: { command: string }) => ({
      exitCode: 0,
      stdout: command.includes('PLAYABLE_OUTPUT_CAP_ACTIVE') ? 'off' : '/root',
    }),
    readTextFile: async ({ path: file }: { path: string }) => written.get(file) ?? null,
    writeTextFile: async ({ path: file, content }: { path: string; content: string }) => {
      written.set(file, content)
    },
  }
  expect(await installOutputCap(sandbox)).toBe(false)
})
