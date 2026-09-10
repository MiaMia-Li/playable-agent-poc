import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentInput,
  BuildResult,
  ConfirmedBuildInput,
  PlayableAgentAdapter,
} from '@/lib/playable/playable-agent-adapter'
import { CodexPlayableAgent } from '@/lib/playable/codex-playable-agent'
import { createValidationReport } from '@/lib/playable/production-contract'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import { defaultConfirmationPresentation } from '@/lib/playable/schemas'

const validProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] as string[] },
  presentation: defaultConfirmationPresentation,
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
    profileId: 'applovin',
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

const requirementBrief = {
  ...createRequirementBrief('做一个中心碰撞玩法'),
  gameplay: {
    concept: '麻将配对',
    coreLoop: '选择相同牌并消除',
    controls: '点击牌面',
    objective: '完成全部配对',
  },
  experience: { visualTheme: '经典麻将', tone: '轻松', camera: '竖屏' },
  assets: { images: 'bundled' as const, audio: 'bundled' as const },
  launch: { title: 'Mahjong Match', cta: '立即下载', locale: 'zh-CN', storeUrl: 'https://example.com/store' },
  openQuestions: [],
  routing: { match: 'exact' as const, mode: 'center_collision' as const, confidence: 1, differences: [] },
}

const confirmationOutput = {
  message: confirmationReply.message,
  reasoning: confirmationReply.reasoning,
  calls: [
    { name: 'update_requirement_brief', brief: requirementBrief, request: null, confirmation: null, revision: null },
    { name: 'list_playable_capabilities', brief: null, request: null, confirmation: null, revision: null },
    { name: 'validate_implementation_route', brief: null, request: null, confirmation: null, revision: null },
    { name: 'submit_confirmation', brief: null, request: null, confirmation: validProposal, revision: null },
  ],
} as const

const researchReport = {
  version: 1 as const,
  runId: 'research-run-1',
  brief: {
    version: 1 as const,
    trigger: 'explicit' as const,
    category: '消除',
    subcategory: '麻将配对',
    gameplayKeywords: ['点击配对'],
    market: '全球',
    locale: 'zh-CN',
    adNetwork: 'AppLovin',
    timeRange: '最近 90 天',
    focusAreas: ['前三秒钩子'],
    requirementSummary: '搜索同类试玩',
  },
  strategyVersion: 'public-web-v1',
  generatedAt: '2026-09-10T01:00:00.000Z',
  industrySummary: {
    coreLoops: ['点击配对'],
    openingHooks: ['接近失败的局面'],
    interactionPatterns: ['单指点击'],
    feedbackPatterns: ['即时消除'],
    ctaPatterns: ['完成后展示 CTA'],
    trends: [],
    saturationRisks: [],
    opportunities: [],
  },
  candidates: [
    {
      id: 'candidate-1',
      title: '牌架配对案例',
      sourceUrl: 'https://ads.tiktok.com/business/creativecenter/example',
      sourceTitle: 'TikTok Creative Center',
      capturedAt: '2026-09-10T01:00:00.000Z',
      categoryTags: ['消除'],
      markets: ['全球'],
      coreLoop: '点击相同目标并消除。',
      controls: '点击',
      openingHook: '接近失败。',
      stateChanges: ['目标消除'],
      feedback: '即时反馈。',
      cta: '完成后展示。',
      borrowableHighlights: ['失败开场'],
      excludedElements: ['品牌素材'],
      evidence: [
        {
          type: 'public_trend' as const,
          label: '公开素材库出现',
          value: null,
          sourceUrl: 'https://ads.tiktok.com/business/creativecenter/example',
          sourceTitle: 'TikTok Creative Center',
          observedAt: '2026-09-10T01:00:00.000Z',
          strength: 'moderate' as const,
        },
      ],
      confidence: 0.8,
      limitations: ['无内部指标'],
    },
  ],
  sourceCoverage: { sourceIds: ['tiktok-creative-center'], failedSourceIds: [] },
  warnings: ['公开趋势不能证明转化表现'],
}

const harnessMocks = vi.hoisted(() => {
  const createCodex = vi.fn(() => ({ harnessId: 'codex' }))
  const createVercelSandbox = vi.fn(() => ({ providerId: 'vercel-sandbox' }))
  const destroy = vi.fn(async () => undefined)
  const createSession = vi.fn(async () => ({ destroy }))
  const stream = vi.fn(async () => ({
    fullStream: (async function* () {})(),
    partialOutputStream: (async function* () {
      yield { message: confirmationOutput.message }
    })(),
    output: Promise.resolve(confirmationOutput),
  }))
  const constructors: unknown[] = []

  return { constructors, createCodex, createSession, createVercelSandbox, destroy, stream }
})

const responseMocks = vi.hoisted(() => {
  const model = { provider: 'openai.responses', modelId: 'gpt-5.6-sol' }
  const responses = vi.fn(() => model)
  const createOpenAI = vi.fn(() => ({ responses }))
  const streamText = vi.fn()
  return { model, responses, createOpenAI, streamText }
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: responseMocks.createOpenAI,
}))

vi.mock('ai7', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai7')>()),
  streamText: responseMocks.streamText,
}))

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
    stream = harnessMocks.stream
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
    harnessMocks.stream.mockClear()
    responseMocks.createOpenAI.mockClear()
    responseMocks.responses.mockClear()
    responseMocks.streamText.mockClear()
    responseMocks.streamText.mockReturnValue({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {
        yield { message: confirmationOutput.message }
      })(),
      output: Promise.resolve(confirmationOutput),
    } as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not require or create a Sandbox while collecting requirements', async () => {
    vi.stubEnv('LOCAL_HARNESS_MODE', '1')
    vi.stubEnv('VERCEL_OIDC_TOKEN', '')
    vi.stubEnv('SANDBOX_VERCEL_TOKEN', '')

    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-missing-sandbox-auth',
        prompt: '制作农场消消乐',
        apiKey: 'sk-unit-test-only',
      }),
    ).resolves.toMatchObject(confirmationReply)
    expect(responseMocks.createOpenAI).toHaveBeenCalledOnce()
    expect(harnessMocks.createVercelSandbox).not.toHaveBeenCalled()
    expect(harnessMocks.createSession).not.toHaveBeenCalled()
  })

  it('forwards accumulated Responses API reasoning summaries while structured output is still forming', async () => {
    responseMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: 'reasoning-delta', text: '正在判断' }
        yield { type: 'reasoning-delta', text: '核心玩法' }
      })(),
      partialOutputStream: (async function* () {
        yield { message: '正在整理方案' }
      })(),
      output: Promise.resolve(confirmationOutput),
    } as never)
    const onProgress = vi.fn()

    await new CodexPlayableAgent().proposeConfirmation(
      { taskId: 'task-stream', prompt: '制作农场消消乐', apiKey: 'sk-unit-test-only' },
      { onProgress },
    )

    expect(onProgress).toHaveBeenCalledWith({ reasoning: '正在判断' })
    expect(onProgress).toHaveBeenCalledWith({ reasoning: '正在判断核心玩法' })
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ message: '正在整理方案', reasoning: expect.any(String) }),
    )
  })

  it('classifies a Responses API full-stream error as a transport failure', async () => {
    responseMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: 'error', error: new TypeError('transport failed') }
      })(),
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve(confirmationOutput),
    } as never)

    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-stream-error',
        prompt: '制作农场消消乐',
        apiKey: 'sk-unit-test-only',
      }),
    ).rejects.toMatchObject({ code: 'stream_failed' })
  })

  it('uses the direct Responses API with low-latency structured output and no Sandbox', async () => {
    const apiKey = 'sk-unit-test-only'
    const input: AgentInput = {
      taskId: 'task-1',
      prompt: `中心碰撞 ${apiKey}`,
      apiKey,
      attachedAssetIds: ['current-image'],
    }
    const agent = new CodexPlayableAgent()
    const onProgress = vi.fn()

    await expect(agent.proposeConfirmation(input, { onProgress })).resolves.toMatchObject(confirmationReply)

    expect(responseMocks.createOpenAI).toHaveBeenCalledWith({ apiKey })
    expect(responseMocks.responses).toHaveBeenCalledWith('gpt-5.6-sol')
    const settings = responseMocks.streamText.mock.calls[0][0] as {
      model: unknown
      instructions: string
      prompt: string
      providerOptions: { openai: Record<string, unknown> }
    }
    expect(settings.model).toBe(responseMocks.model)
    expect(settings.instructions).toContain('domain tools')
    expect(settings.instructions).toContain('respond_to_user')
    expect(settings.instructions).toContain('update_requirement_brief')
    expect(settings.instructions).toContain('validate_implementation_route')
    expect(settings.instructions).toContain('freeform')
    expect(settings.instructions).toContain('AI media generation is unavailable')
    expect(settings.providerOptions.openai).toEqual({
      reasoningEffort: 'low',
      reasoningSummary: 'auto',
      store: false,
      strictJsonSchema: true,
    })
    expect(settings.prompt).not.toContain(apiKey)
    expect(settings.prompt).toContain('"attachedAssetIds":["current-image"]')
    expect(onProgress).toHaveBeenCalledWith({ message: confirmationOutput.message, reasoning: undefined })
    expect(harnessMocks.createVercelSandbox).not.toHaveBeenCalled()
    expect(harnessMocks.createSession).not.toHaveBeenCalled()
  })

  it('executes reference analysis tools and supplies their structured results to the next model step', async () => {
    const toolCall = {
      name: 'inspect_reference_images' as const,
      assetIds: ['image-1', 'image-2'],
      assetId: null,
      searchBrief: null,
    }
    responseMocks.streamText
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve({
          kind: 'tool_calls',
          message: null,
          reasoning: '需要先分析参考图片。',
          toolCalls: [toolCall, toolCall],
          plan: null,
        }),
      } as never)
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve({
          kind: 'terminal',
          message: null,
          reasoning: '分析结果足以完成决策。',
          toolCalls: [],
          plan: confirmationOutput,
        }),
      } as never)
    const executeTool = vi.fn(async () => ({ observations: ['蓝色海洋主题'], confidence: 0.9 }))
    const onProgress = vi.fn()

    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'task-analysis-loop', prompt: '参考这些图片制作游戏', apiKey: 'sk-unit-test-only' },
        { executeTool, onProgress },
      ),
    ).resolves.toMatchObject(confirmationReply)

    expect(executeTool).toHaveBeenCalledOnce()
    expect(executeTool).toHaveBeenCalledWith(toolCall, {
      abortSignal: expect.any(AbortSignal),
    })
    expect(responseMocks.streamText).toHaveBeenCalledTimes(2)
    const secondPrompt = (responseMocks.streamText.mock.calls[1][0] as { prompt: string }).prompt
    expect(secondPrompt).toContain('"tool":"inspect_reference_images"')
    expect(secondPrompt).toContain('"observations":["蓝色海洋主题"]')
    expect(onProgress).toHaveBeenCalledWith({ type: 'tool_started', toolCall })
    expect(onProgress).toHaveBeenCalledWith({ type: 'tool_completed', toolCall })
  })

  it('returns a trusted research report without asking the model to rewrite it', async () => {
    const searchBrief = researchReport.brief
    responseMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve({
        kind: 'tool_calls',
        message: null,
        reasoning: '用户明确要求搜索。',
        toolCalls: [
          {
            name: 'search_market_references',
            assetIds: [],
            assetId: null,
            searchBrief,
          },
        ],
        plan: null,
      }),
    } as never)
    const executeTool = vi.fn(async () => researchReport)

    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'task-research', prompt: '搜索同类试玩', apiKey: 'sk-unit-test-only' },
        { executeTool },
      ),
    ).resolves.toMatchObject({ kind: 'research', research: researchReport })
    expect(executeTool).toHaveBeenCalledOnce()
    expect(responseMocks.streamText).toHaveBeenCalledOnce()
  })

  it('fails analysis requests safely when no tool executor is available', async () => {
    responseMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve({
        kind: 'tool_calls',
        message: null,
        reasoning: '需要先分析视频。',
        toolCalls: [{ name: 'analyze_reference_video', assetIds: [], assetId: 'video-1', searchBrief: null }],
        plan: null,
      }),
    } as never)

    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-analysis-without-executor',
        prompt: '分析参考视频',
        apiKey: 'sk-unit-test-only',
      }),
    ).rejects.toMatchObject({ code: 'output_invalid' })
  })

  it('rejects invalid structured output without silently repairing it', async () => {
    responseMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve({
        ...confirmationOutput,
        calls: confirmationOutput.calls.map((call) =>
          call.name === 'submit_confirmation' ? { ...call, confirmation: { ...validProposal, mode: 'custom' } } : call,
        ),
      }),
    } as never)

    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-invalid',
        prompt: '自定义玩法',
        apiKey: 'sk-invalid-test',
      }),
    ).rejects.toThrow()
  })

  it('rejects an empty API key before creating an OpenAI provider', async () => {
    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'task-empty-key',
        prompt: '中心碰撞',
        apiKey: '',
      }),
    ).rejects.toThrow('API key is required')
    expect(responseMocks.createOpenAI).not.toHaveBeenCalled()
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
