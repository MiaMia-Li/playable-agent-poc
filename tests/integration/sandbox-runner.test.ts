import { exec } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  runPlayableBuild,
  type PlayableSandbox,
  type RunPlayableBuildDependencies,
} from '@/lib/playable/sandbox-runner'
import type { ConfirmedBuildInput } from '@/lib/playable/playable-agent-adapter'
import type { PlayableModeId } from '@/lib/playable/types'

const execAsync = promisify(exec)
const temporaryDirectories: string[] = []
const MAX_PLAYABLE_BYTES = 5 * 1024 * 1024

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

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
  readonly commands: Array<{
    command: string
    env?: Record<string, string>
    workingDirectory?: string
    abortSignal?: AbortSignal
  }> = []
  readonly ioAbortSignals: Array<AbortSignal | undefined> = []
  readonly defaultWorkingDirectory: string
  destroyed = false
  destroyError: Error | undefined

  constructor(root: string) {
    this.defaultWorkingDirectory = root
  }

  async writeBinaryFile({
    path: filePath,
    content,
    abortSignal,
  }: {
    path: string
    content: Uint8Array
    abortSignal?: AbortSignal
  }) {
    this.ioAbortSignals.push(abortSignal)
    abortSignal?.throwIfAborted()
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }

  async writeTextFile({
    path: filePath,
    content,
    abortSignal,
  }: {
    path: string
    content: string
    abortSignal?: AbortSignal
  }) {
    this.ioAbortSignals.push(abortSignal)
    abortSignal?.throwIfAborted()
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
  }

  async readBinaryFile({ path: filePath, abortSignal }: { path: string; abortSignal?: AbortSignal }) {
    this.ioAbortSignals.push(abortSignal)
    abortSignal?.throwIfAborted()
    try {
      return new Uint8Array(await readFile(filePath))
    } catch {
      return null
    }
  }

  async readTextFile({ path: filePath, abortSignal }: { path: string; abortSignal?: AbortSignal }) {
    this.ioAbortSignals.push(abortSignal)
    abortSignal?.throwIfAborted()
    try {
      return await readFile(filePath, 'utf8')
    } catch {
      return null
    }
  }

  async run(options: {
    command: string
    env?: Record<string, string>
    workingDirectory?: string
    abortSignal?: AbortSignal
  }) {
    this.commands.push(options)
    try {
      const result = await execAsync(options.command, {
        cwd: options.workingDirectory ?? this.defaultWorkingDirectory,
        env: { ...process.env, ...options.env },
        maxBuffer: 10 * 1024 * 1024,
        signal: options.abortSignal,
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
    if (this.destroyError) throw this.destroyError
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

function replaceArtifactCommands(sandbox: LocalSandbox, artifact: Uint8Array | string) {
  const run = sandbox.run.bind(sandbox)
  sandbox.run = async (options) => {
    if (options.command.includes('build-playable.mjs')) {
      sandbox.commands.push(options)
      const content = typeof artifact === 'string' ? artifact : artifact
      await writeFile(path.join(sandbox.defaultWorkingDirectory, 'work', 'output.html'), content)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    if (options.command.includes('test-playable.mjs')) {
      sandbox.commands.push(options)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    return run(options)
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
  it('requires an agent executor in its public dependency contract', async () => {
    type Dependencies = Parameters<typeof runPlayableBuild>[1]
    type ExecuteAgentIsRequired = {} extends Pick<Dependencies, 'executeAgent'> ? false : true
    expectTypeOf<ExecuteAgentIsRequired>().toEqualTypeOf<true>()

    const sandbox = await createLocalSandbox()
    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-required-agent-test'), {
        createSandbox: async () => sandbox,
      } as unknown as RunPlayableBuildDependencies),
    ).rejects.toThrow('Agent executor is required')
    expect(sandbox.destroyed).toBe(false)
  })

  it.each(['center_collision', 'top_rack', 'gravity_fill', 'perspective_3d'] as const)(
    'copies and validates an isolated %s Skill build with deterministic local commands',
    async (mode) => {
      const apiKey = `sk-integration-${mode}`
      const sandbox = await createLocalSandbox()
      const controller = new AbortController()
      const logs: string[] = []
      const result = await runPlayableBuild(buildInput(mode, apiKey), {
        createSandbox: async () => sandbox,
        executeAgent: async ({ authEnvironment, workspace, sandbox: agentSandbox, abortSignal }) => {
          expect(authEnvironment).toEqual({ CODEX_API_KEY: apiKey })
          expect(Object.keys(authEnvironment)).toEqual(['CODEX_API_KEY'])
          expect(workspace).toBe(path.join(sandbox.defaultWorkingDirectory, 'work'))
          await agentSandbox.writeTextFile({
            path: path.join(workspace, 'agent-secret-bearing-output.txt'),
            content: apiKey,
            abortSignal,
          })
          return { ignoredSecretBearingAgentResult: apiKey }
        },
        logger: { info: async (message) => void logs.push(message) },
        abortSignal: controller.signal,
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
      expect(sandbox.ioAbortSignals.every((signal) => signal !== undefined)).toBe(true)
      expect(
        await sandbox.readBinaryFile({
          path: path.join(sandbox.defaultWorkingDirectory, 'skill-master', '.DS_Store'),
        }),
      ).toBeNull()

      const sourceSkill = await readFile(path.join(process.cwd(), 'skills/mahjong-pair-match-playable/SKILL.md'))
      const copiedMaster = await readFile(path.join(sandbox.defaultWorkingDirectory, 'skill-master', 'SKILL.md'))
      expect(copiedMaster).toEqual(sourceSkill)
    },
    30_000,
  )

  it('copies owned uploaded bytes into the task workspace and returns a truthful safe manifest', async () => {
    const sandbox = await createLocalSandbox()
    const input = buildInput('center_collision', 'sk-assets-test')
    input.assets = [
      {
        id: 'asset-1',
        slot: 'audio',
        filename: 'sound.mp3',
        mimeType: 'audio/mpeg',
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]

    const result = await runPlayableBuild(input, {
      createSandbox: async () => sandbox,
      executeAgent: async ({ workspace }) => {
        expect(await readFile(path.join(workspace, 'user-assets', 'audio', 'asset-1-sound.mp3'))).toEqual(
          Buffer.from([1, 2, 3]),
        )
      },
    })

    expect(result.assetManifest).toEqual({
      assets: [
        {
          id: 'asset-1',
          slot: 'audio',
          filename: 'sound.mp3',
          mimeType: 'audio/mpeg',
          size: 3,
          workspacePath: 'user-assets/audio/asset-1-sound.mp3',
        },
      ],
      entrypoint: 'playable.html',
    })
    expect(JSON.stringify(result.assetManifest)).not.toContain('users/')
    expect(JSON.stringify(result.assetManifest)).not.toContain('sk-assets-test')
  })

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
        executeAgent: async () => undefined,
        skillRoot: path.join(os.tmpdir(), 'missing-playable-skill'),
      }),
    ).rejects.toThrow()
    expect(created).toBe(false)
  })

  it('rejects master tampering and destroys the sandbox', async () => {
    const sandbox = await createLocalSandbox()

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-master-tamper-test'), {
        createSandbox: async () => sandbox,
        executeAgent: async ({ sandbox: agentSandbox }) => {
          await execAsync('chmod u+w skill-master/SKILL.md', { cwd: sandbox.defaultWorkingDirectory })
          await agentSandbox.writeTextFile({
            path: path.join(sandbox.defaultWorkingDirectory, 'skill-master', 'SKILL.md'),
            content: 'tampered',
          })
        },
      }),
    ).rejects.toThrow('Skill master was modified')
    expect(sandbox.destroyed).toBe(true)
  })

  it('rejects an artifact at the 5 MiB boundary and destroys the sandbox', async () => {
    const sandbox = await createLocalSandbox()
    const artifact = new Uint8Array(MAX_PLAYABLE_BYTES)
    artifact.set(new TextEncoder().encode('window.__PLAYABLE__'))
    replaceArtifactCommands(sandbox, artifact)

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-size-test'), {
        createSandbox: async () => sandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('Playable artifact exceeds size limit')
    expect(sandbox.destroyed).toBe(true)
  })

  it('rejects an artifact without window.__PLAYABLE__ and destroys the sandbox', async () => {
    const sandbox = await createLocalSandbox()
    replaceArtifactCommands(sandbox, '<html>missing contract</html>')

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-contract-test'), {
        createSandbox: async () => sandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('Playable artifact contract is missing')
    expect(sandbox.destroyed).toBe(true)
  })

  it('rejects an API key written and returned by a fake agent in HTML and destroys the sandbox', async () => {
    const apiKey = 'sk-agent-leak-test'
    const sandbox = await createLocalSandbox()
    const run = sandbox.run.bind(sandbox)
    sandbox.run = async (options) => {
      if (options.command.includes('build-playable.mjs') || options.command.includes('test-playable.mjs')) {
        sandbox.commands.push(options)
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return run(options)
    }

    await expect(
      runPlayableBuild(buildInput('center_collision', apiKey), {
        createSandbox: async () => sandbox,
        executeAgent: async ({ sandbox: agentSandbox, workspace, abortSignal }) => {
          await agentSandbox.writeTextFile({
            path: path.join(workspace, 'output.html'),
            content: `<script>window.__PLAYABLE__={secret:${JSON.stringify(apiKey)}}</script>`,
            abortSignal,
          })
          return { secretBearingResult: apiKey }
        },
      }),
    ).rejects.toThrow('Playable artifact contains a credential')
    expect(sandbox.destroyed).toBe(true)
  })

  it('preserves CSS and URLs containing non-credential sk fragments', async () => {
    const sandbox = await createLocalSandbox()
    const html =
      '<style>.x{mask-image:none;-webkit-mask-size:cover}</style><script>window.__PLAYABLE__={name:"sk-chase",url:"https://example.com/task-1234"}</script>'
    replaceArtifactCommands(sandbox, html)

    const result = await runPlayableBuild(buildInput('center_collision', 'sk-exact-caller-key'), {
      createSandbox: async () => sandbox,
      executeAgent: async () => undefined,
    })

    expect(result.html).toBe(html)
    expect(sandbox.destroyed).toBe(true)
  })

  it('rejects a realistic credential-shaped non-caller key in generated HTML', async () => {
    const sandbox = await createLocalSandbox()
    const otherSecret = 'sk-1234567890abcdefghijklmnop'
    replaceArtifactCommands(sandbox, `<script>window.__PLAYABLE__={secret:${JSON.stringify(otherSecret)}}</script>`)

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-exact-caller-key'), {
        createSandbox: async () => sandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('Playable artifact contains a credential')
    expect(sandbox.destroyed).toBe(true)
  })

  it('rejects an API key in serialized confirmation and destroys the sandbox', async () => {
    const apiKey = 'sk-confirmation-leak-test'
    const sandbox = await createLocalSandbox()
    const input = buildInput('center_collision', apiKey)
    input.confirmation = { ...input.confirmation, storeUrl: `https://example.com/${apiKey}` }

    await expect(
      runPlayableBuild(input, {
        createSandbox: async () => sandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('Confirmation contains a credential')
    expect(sandbox.destroyed).toBe(true)
  })

  it('rejects an empty API key before allocating a sandbox', async () => {
    const createSandbox = vi.fn(async () => createLocalSandbox())

    await expect(
      runPlayableBuild(buildInput('center_collision', ''), {
        createSandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('API key is required')
    expect(createSandbox).not.toHaveBeenCalled()
  })

  it('propagates cancellation while copying Skill files and destroys the sandbox', async () => {
    const sandbox = await createLocalSandbox()
    const started = deferred()
    sandbox.writeBinaryFile = async ({ abortSignal }) => {
      started.resolve()
      await new Promise<void>((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(new Error('copy aborted')), { once: true })
      })
    }
    const controller = new AbortController()
    const build = runPlayableBuild(buildInput('center_collision', 'sk-copy-cancel-test'), {
      createSandbox: async () => sandbox,
      executeAgent: async () => undefined,
      abortSignal: controller.signal,
    })

    await started.promise
    controller.abort()

    await expect(build).rejects.toThrow('copy aborted')
    expect(sandbox.destroyed).toBe(true)
  })

  it('propagates cancellation during the master integrity sweep and destroys the sandbox', async () => {
    const sandbox = await createLocalSandbox()
    const readBinaryFile = sandbox.readBinaryFile.bind(sandbox)
    const started = deferred()
    let agentFinished = false
    sandbox.readBinaryFile = async (options) => {
      if (agentFinished && options.path.includes(`${path.sep}skill-master${path.sep}`)) {
        started.resolve()
        await new Promise<void>((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(new Error('integrity aborted')), { once: true })
        })
      }
      return readBinaryFile(options)
    }
    const controller = new AbortController()
    const build = runPlayableBuild(buildInput('center_collision', 'sk-integrity-cancel-test'), {
      createSandbox: async () => sandbox,
      executeAgent: async () => {
        agentFinished = true
      },
      abortSignal: controller.signal,
    })

    await started.promise
    controller.abort()

    await expect(build).rejects.toThrow('integrity aborted')
    expect(sandbox.destroyed).toBe(true)
  })

  it('preserves the original build error when sandbox destruction also fails', async () => {
    const sandbox = await createLocalSandbox()
    sandbox.destroyError = new Error('destroy failed')
    const run = sandbox.run.bind(sandbox)
    sandbox.run = async (options) =>
      options.command.includes('test-playable.mjs')
        ? { exitCode: 1, stdout: '', stderr: 'validation failed' }
        : run(options)

    await expect(
      runPlayableBuild(buildInput('center_collision', 'sk-destroy-error-test'), {
        createSandbox: async () => sandbox,
        executeAgent: async () => undefined,
      }),
    ).rejects.toThrow('Playable validation failed')
    expect(sandbox.destroyed).toBe(true)
  })
})
