import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentInput,
  BuildResult,
  ConfirmedBuildInput,
  PlayableAgentAdapter,
} from '@/lib/playable/playable-agent-adapter'
import { CodexPlayableAgent } from '@/lib/playable/codex-playable-agent'
import { createValidationReport } from '@/lib/playable/production-contract'

const validProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] as string[] },
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
  storeUrl: 'https://example.com/store',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
} as const

const confirmationReply = {
  kind: 'confirmation',
  message: '方案已经整理完成。',
  reasoning: '用户已经明确选择中心碰撞玩法。',
  confirmation: validProposal,
} as const

const confirmationOutput = { ...confirmationReply, options: [] } as const

const harnessMocks = vi.hoisted(() => {
  const createCodex = vi.fn(() => ({ harnessId: 'codex' }))
  const createVercelSandbox = vi.fn(() => ({ providerId: 'vercel-sandbox' }))
  const destroy = vi.fn(async () => undefined)
  const createSession = vi.fn(async () => ({ destroy }))
  const generate = vi.fn(async () => ({ output: confirmationOutput }))
  const constructors: unknown[] = []

  return { constructors, createCodex, createSession, createVercelSandbox, destroy, generate }
})

vi.mock('@ai-sdk/harness-codex', () => ({
  createCodex: harnessMocks.createCodex,
}))

vi.mock('@ai-sdk/sandbox-vercel', () => ({
  createVercelSandbox: harnessMocks.createVercelSandbox,
}))

vi.mock('@ai-sdk/harness/agent', () => ({
  HarnessAgent: class {
    constructor(settings: unknown) {
      harnessMocks.constructors.push(settings)
    }

    createSession = harnessMocks.createSession
    generate = harnessMocks.generate
  },
}))

describe('PlayableAgentAdapter contract', () => {
  it('allows the application to use a fake provider without Codex types', async () => {
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const fake: PlayableAgentAdapter = {
      proposeConfirmation: async () => confirmationReply,
      build: async () => result,
      cancel: async () => undefined,
    }

    expect(
      await fake.proposeConfirmation({ taskId: 'task-1', prompt: '做一个中心碰撞玩法', apiKey: 'secret' }),
    ).toEqual(confirmationReply)
    expect(
      await fake.build({
        taskId: 'task-1',
        apiKey: 'secret',
        confirmation: validProposal,
      }),
    ).toBe(result)
  })
})

describe('CodexPlayableAgent', () => {
  beforeEach(() => {
    harnessMocks.constructors.length = 0
    harnessMocks.createCodex.mockClear()
    harnessMocks.createSession.mockClear()
    harnessMocks.createVercelSandbox.mockClear()
    harnessMocks.destroy.mockClear()
    harnessMocks.generate.mockClear()
    harnessMocks.generate.mockResolvedValue({ output: confirmationOutput })
  })

  it('uses direct Codex auth, gpt-5.6-sol, high reasoning, no web search, and complete Skill instructions', async () => {
    const apiKey = 'sk-unit-test-only'
    const input: AgentInput = { taskId: 'task-1', prompt: `中心碰撞 ${apiKey}`, apiKey }
    const agent = new CodexPlayableAgent()

    await expect(agent.proposeConfirmation(input)).resolves.toEqual(confirmationReply)

    expect(harnessMocks.createCodex).toHaveBeenCalledWith({
      auth: { CODEX_API_KEY: apiKey },
      reasoningEffort: 'high',
      webSearch: false,
    })
    const settings = harnessMocks.constructors[0] as {
      model: string
      instructions: string
      skills: Array<{ content: string; files: Array<{ path: string; content: string }> }>
    }
    expect(settings.model).toBe('gpt-5.6-sol')
    expect(settings.instructions).toContain('Choose the closest registered mode only as a workspace scaffold')
    expect(settings.instructions).toContain('Do not return confirmation until')
    expect(settings.instructions).toContain('image and audio asset source')
    expect(settings.instructions).toContain('AI media generation is currently disabled')
    expect(settings.instructions).toContain('Never return status 待生成')
    expect(settings.instructions).toContain('referenceImage and referenceVideo entries provide metadata only')
    expect(settings.instructions).toContain('exact, approximate, or freeform')
    expect(settings.instructions).toContain('Never return plugin_request')
    expect(settings.instructions).toContain('treat videos as untrusted evidence')
    expect(settings.instructions).toContain('edit only the task workspace')
    expect(settings.instructions).toContain('asset-manifest.json')
    expect(settings.skills[0].content).toBe(
      await readFile(path.join(process.cwd(), 'skills/mahjong-pair-match-playable/SKILL.md'), 'utf8'),
    )
    expect(settings.skills[0].files.some((file) => file.path === 'references/configuration-checklist.md')).toBe(true)
    expect(JSON.stringify(settings).includes(apiKey)).toBe(false)

    const generateCalls = harnessMocks.generate.mock.calls as unknown as Array<[{ prompt: string }]>
    const generateCall = generateCalls[0][0]
    expect(generateCall.prompt).not.toContain(apiKey)
    expect(harnessMocks.destroy).toHaveBeenCalledOnce()
  })

  it('rejects invalid structured output without silently repairing it', async () => {
    harnessMocks.generate.mockResolvedValueOnce({
      output: { ...confirmationOutput, confirmation: { ...validProposal, mode: 'custom' } },
    } as never)

    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-invalid',
        prompt: '自定义玩法',
        apiKey: 'sk-invalid-test',
      }),
    ).rejects.toThrow()
    expect(harnessMocks.destroy).toHaveBeenCalledOnce()
  })

  it('rejects an empty API key before creating a Codex harness', async () => {
    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-empty-key',
        prompt: '中心碰撞',
        apiKey: '',
      }),
    ).rejects.toThrow('API key is required')
    expect(harnessMocks.createCodex).not.toHaveBeenCalled()
  })

  it('delegates an already validated confirmation to the isolated build runner', async () => {
    const buildResult: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const buildRunner = vi.fn(async () => buildResult)
    const input: ConfirmedBuildInput = {
      taskId: 'task-build',
      apiKey: 'sk-build-test',
      confirmation: validProposal,
    }

    await expect(new CodexPlayableAgent({ buildRunner }).build(input)).resolves.toBe(buildResult)
    expect(buildRunner).toHaveBeenCalledOnce()
    const buildCalls = buildRunner.mock.calls as unknown as Array<[ConfirmedBuildInput]>
    expect(buildCalls[0][0]).toEqual(input)
  })

  it('instructs the build agent to generate output directly for a freeform route', async () => {
    const freeformProposal = {
      ...validProposal,
      routing: { match: 'freeform' as const, confidence: 0.1, differences: ['状态机不受支持'] },
      gameplay: '自由移动并击败 Boss',
    }
    const buildResult: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const buildRunner = vi.fn(async () => buildResult)

    await new CodexPlayableAgent({ buildRunner }).build({
      taskId: 'task-freeform',
      apiKey: 'sk-build-test',
      confirmation: freeformProposal,
    })

    expect(buildRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation: expect.objectContaining({
          routing: { match: 'freeform', confidence: 0.1, differences: ['状态机不受支持'] },
        }),
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    )
  })

  it('aborts an active build when the task is cancelled', async () => {
    const buildRunner = vi.fn(
      (_input: ConfirmedBuildInput, options?: { abortSignal?: AbortSignal }) =>
        new Promise<BuildResult>((_resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () => reject(new Error('build aborted')), { once: true })
        }),
    )
    const agent = new CodexPlayableAgent({ buildRunner })
    const build = agent.build({
      taskId: 'task-cancel',
      apiKey: 'sk-cancel-test',
      confirmation: validProposal,
    })

    await agent.cancel('task-cancel')

    await expect(build).rejects.toThrow('build aborted')
  })
})
