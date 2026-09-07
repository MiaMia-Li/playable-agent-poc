import { exec } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { runPlayableBuild, type PlayableSandbox } from '@/lib/playable/sandbox-runner'
import type { ConfirmedBuildInput } from '@/lib/playable/playable-agent-adapter'
import type { PlayableModeId } from '@/lib/playable/types'

const execAsync = promisify(exec)
const temporaryDirectories: string[] = []

const baseConfirmation = {
  mode: 'center_collision',
  gameplay: '相同牌向中心碰撞、破碎并计分',
  resources: {
    tileFaces: { status: '内置默认', treatment: '使用内置麻将牌面' },
    backgroundBoard: { status: '内置默认', treatment: '使用内置背景和棋盘' },
    animationEffects: { status: '内置默认', treatment: '使用模式默认动画' },
    audio: { status: '内置默认', treatment: '使用内置音频' },
    endCard: { status: '内置默认', treatment: '使用内置结束卡' },
  },
  copy: {
    title: 'Mahjong Match',
    cta: '立即下载',
    disclaimer: '演示内容仅供参考',
    locale: 'zh-CN',
  },
  storeUrl: 'https://example.com/store?campaign=deterministic',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
} as const

class LocalSandbox implements PlayableSandbox {
  readonly commands: Array<{ command: string; env?: Record<string, string>; workingDirectory?: string }> = []
  readonly defaultWorkingDirectory: string
  destroyed = false

  constructor(root: string) {
    this.defaultWorkingDirectory = root
  }

  async writeBinaryFile({ path: filePath, content }: { path: string; content: Uint8Array }) {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }

  async writeTextFile({ path: filePath, content }: { path: string; content: string }) {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
  }

  async readBinaryFile({ path: filePath }: { path: string }) {
    try {
      return new Uint8Array(await readFile(filePath))
    } catch {
      return null
    }
  }

  async readTextFile({ path: filePath }: { path: string }) {
    try {
      return await readFile(filePath, 'utf8')
    } catch {
      return null
    }
  }

  async run(options: { command: string; env?: Record<string, string>; workingDirectory?: string }) {
    this.commands.push(options)
    try {
      const result = await execAsync(options.command, {
        cwd: options.workingDirectory ?? this.defaultWorkingDirectory,
        env: { ...process.env, ...options.env },
        maxBuffer: 10 * 1024 * 1024,
      })
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      return {
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      }
    }
  }

  async destroy() {
    this.destroyed = true
  }
}

async function createLocalSandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playable-sandbox-'))
  temporaryDirectories.push(root)
  return new LocalSandbox(root)
}

function buildInput(mode: PlayableModeId, apiKey: string): ConfirmedBuildInput {
  return {
    taskId: `task-${mode}`,
    apiKey,
    confirmation: { ...baseConfirmation, mode },
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await execAsync('chmod -R u+w .', { cwd: directory }).catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

describe('runPlayableBuild', () => {
  it.each(['center_collision', 'top_rack', 'gravity_fill', 'perspective_3d'] as const)(
    'copies and validates an isolated %s Skill build with deterministic local commands',
    async (mode) => {
      const apiKey = `sk-integration-${mode}`
      const sandbox = await createLocalSandbox()
      const logs: string[] = []
      const result = await runPlayableBuild(buildInput(mode, apiKey), {
        createSandbox: async () => sandbox,
        executeAgent: async ({ authEnvironment, workspace }) => {
          expect(authEnvironment).toEqual({ CODEX_API_KEY: apiKey })
          expect(Object.keys(authEnvironment)).toEqual(['CODEX_API_KEY'])
          expect(workspace).toBe(path.join(sandbox.defaultWorkingDirectory, 'work'))
        },
        logger: { info: async (message) => void logs.push(message) },
      })

      expect(result.validation.behavior).toBe('passed')
      expect(result.validation.bytes).toBeLessThan(5 * 1024 * 1024)
      expect(result.html).toContain('window.__PLAYABLE__')
      expect(result.html).not.toContain(apiKey)
      expect(sandbox.destroyed).toBe(true)

      const recorded = JSON.stringify({ commands: sandbox.commands, logs })
      expect(recorded).not.toContain(apiKey)
      expect(
        await readFile(path.join(sandbox.defaultWorkingDirectory, 'work', 'confirmed-config.json'), 'utf8'),
      ).not.toContain(apiKey)
      expect(sandbox.commands.every(({ env }) => env?.CODEX_API_KEY === undefined)).toBe(true)

      const sourceSkill = await readFile(path.join(process.cwd(), 'skills/mahjong-pair-match-playable/SKILL.md'))
      const copiedMaster = await readFile(path.join(sandbox.defaultWorkingDirectory, 'skill-master', 'SKILL.md'))
      expect(copiedMaster).toEqual(sourceSkill)
    },
    30_000,
  )

  it('returns no artifact and destroys the sandbox when validation fails', async () => {
    const sandbox = await createLocalSandbox()
    const run = sandbox.run.bind(sandbox)
    sandbox.run = async (options) =>
      options.command.includes('test-playable.mjs')
        ? { exitCode: 1, stdout: '', stderr: 'deterministic failure' }
        : run(options)

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-failure-test'), {
        createSandbox: async () => sandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('Playable validation failed')
    expect(sandbox.destroyed).toBe(true)
  })

  it('does not allocate a sandbox when the local Skill cannot be prepared', async () => {
    let created = false

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-missing-skill-test'), {
        createSandbox: async () => {
          created = true
          return createLocalSandbox()
        },
        skillRoot: path.join(os.tmpdir(), 'missing-playable-skill'),
      }),
    ).rejects.toThrow()
    expect(created).toBe(false)
  })
})
