import { z } from 'zod'
import { executeBuildAgent } from '@/lib/playable/codex-playable-agent'
import type { PlayableSandbox } from '@/lib/playable/sandbox-runner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentInput,
  BuildResult,
  ConfirmedBuildInput,
  PlayableAgentAdapter,
} from '@/lib/playable/playable-agent-adapter'
import { CodexPlayableAgent, createCodexBuildAgent, createCodexBuildPrompt } from '@/lib/playable/codex-playable-agent'
import { createValidationReport } from '@/lib/playable/production-contract'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import { PlayableBuildExecutionError } from '@/lib/playable/sandbox-runner'
import { defaultConfirmationPresentation } from '@/lib/playable/schemas'

const validProposal = {
  visualDirection: 'custom' as const,
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
    maxBytes: 10485760,
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
    {
      name: 'update_requirement_brief',
      annotations: null,
      brief: requirementBrief,
      request: null,
      confirmation: null,
      revision: null,
    },
    {
      name: 'list_playable_capabilities',
      annotations: null,
      brief: null,
      request: null,
      confirmation: null,
      revision: null,
    },
    {
      name: 'validate_implementation_route',
      annotations: null,
      brief: null,
      request: null,
      confirmation: null,
      revision: null,
    },
    {
      name: 'submit_confirmation',
      annotations: null,
      brief: null,
      request: null,
      confirmation: validProposal,
      revision: null,
    },
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
  const model = { provider: 'openai.responses', modelId: 'openai/gpt-5.6-sol' }
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

  it.each(
    [
      {
        rule: 'terminal_missing',
        stage: 'plan_execution',
        output: { ...confirmationOutput, calls: confirmationOutput.calls.slice(0, -1) },
      },
      { rule: 'schema_invalid', stage: 'step_validation', output: { ...confirmationOutput, message: 42 } },
      {
        rule: 'step_shape_invalid',
        stage: 'step_validation',
        output: { kind: 'tool_calls', message: null, reasoning: 'Check', toolCalls: [], plan: null },
      },
    ].flatMap((scenario) => [false, true].map((repeated) => ({ ...scenario, repeated }))),
  )('repairs $rule once (repeated: $repeated)', async ({ repeated, rule, stage, output: incomplete }) => {
    for (const output of [incomplete, repeated ? incomplete : confirmationOutput]) {
      responseMocks.streamText.mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve(output),
      } as never)
    }
    const result = new CodexPlayableAgent().proposeConfirmation({
      taskId: 'requirement-validation-repair',
      prompt: '调整游戏需求',
      apiKey: 'unit-key',
    })
    if (repeated) {
      await expect(result).rejects.toMatchObject({
        code: 'output_invalid',
        diagnostic: { stage, step: 2, rule },
      })
    } else {
      await expect(result).resolves.toMatchObject({ kind: 'confirmation' })
    }
    expect(responseMocks.streamText).toHaveBeenCalledTimes(2)
    expect(responseMocks.streamText.mock.calls[0][0].instructions).not.toContain('previous plan was rejected')
    expect(responseMocks.streamText.mock.calls[1][0].instructions).toContain('previous plan was rejected')
  })

  it('repairs nested structured-output validation errors without exposing rejected values', async () => {
    const parsed = z.object({ message: z.number() }).safeParse({ message: 'private-rejected-value' })
    if (parsed.success) throw new Error('Invalid fixture expected')
    responseMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {})(),
      get output() {
        return Promise.reject(new Error('private-provider-detail', { cause: parsed.error }))
      },
    } as never)
    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'schema-repair',
        prompt: '调整玩法',
        apiKey: 'unit-key',
      }),
    ).resolves.toMatchObject({ kind: 'confirmation' })
    expect(responseMocks.streamText).toHaveBeenCalledTimes(2)
    const instructions = responseMocks.streamText.mock.calls[1][0].instructions
    expect(instructions).toContain('structured_output')
    expect(instructions).toContain('invalid_type')
    expect(instructions).not.toContain('private-')
  })

  it('propagates cancellation of one build without cancelling a replacement build', async () => {
    const signals: AbortSignal[] = []
    const pending: Array<() => void> = []
    const buildRunner = vi.fn((_input: ConfirmedBuildInput, options?: { abortSignal?: AbortSignal }) => {
      signals.push(options!.abortSignal!)
      return new Promise<BuildResult>((_resolve, reject) => {
        pending.push(() => reject(new Error('finished')))
      })
    })
    const agent = new CodexPlayableAgent({ buildRunner })
    const firstController = new AbortController()
    const input = { taskId: 'same-task', apiKey: 'sk-test', confirmation: validProposal }
    const first = agent.build({ ...input, abortSignal: firstController.signal }).catch(() => undefined)
    const second = agent.build(input).catch(() => undefined)
    firstController.abort()
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    // 让旧构建先退出，再按任务取消，验证旧 finally 没有删除新构建的取消句柄。
    pending[0]()
    await first
    await agent.cancel(input.taskId)
    expect(signals[1].aborted).toBe(true)
    pending[1]()
    await second
  })

  it('configures Codex Harness to use OpenRouter Responses', () => {
    createCodexBuildAgent({
      apiKey: 'sk-or-test',
      skill: {
        name: 'test-skill',
        description: 'Test skill.',
        content: 'Build.',
        files: [],
      },
    })

    expect(harnessMocks.createCodex).toHaveBeenCalledWith({
      auth: {
        CODEX_API_KEY: 'sk-or-test',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      },
      reasoningEffort: 'high',
      webSearch: false,
    })
    expect(harnessMocks.constructors[0]).toEqual(
      expect.objectContaining({
        model: 'openai/gpt-5.6-sol',
      }),
    )
  })

  it('tells patch revisions to preserve the final artifact and use adapted validation', () => {
    const prompt = createCodexBuildPrompt('approximate', {
      id: 'revision-1',
      baseBuildId: 'build-1',
      baseVersion: 1,
      targetVersion: 2,
      strategy: 'patch',
      summary: 'Replace tile faces.',
      changes: ['Use fruit tiles'],
      preserved: ['Keep gameplay'],
    })

    expect(prompt).toContain('current-playable.html')
    expect(prompt).toContain('Do not run the registered template build command')
    expect(prompt).toContain('test-freeform-playable.mjs')
  })

  it.each(['exact', 'approximate', 'freeform'] as const)('独立模板补丁优先于旧 mode，并统一校验：%s', (route) => {
    const prompt = createCodexBuildPrompt(
      route,
      {
        id: 'revision-source',
        baseBuildId: 'build-source',
        baseVersion: 1,
        targetVersion: 2,
        strategy: 'patch',
        summary: '调整转轴顺序',
        changes: ['移除第一轮'],
        preserved: ['保留转轴引擎'],
      },
      'dragon_slots',
      'perspective_3d',
    )
    expect(prompt).toContain('Copy current-playable.html to output.html')
    expect(prompt).toContain('revision-plan.json')
    expect(prompt).toContain('sourceTemplateId and confirmed gameplay take precedence')
    expect(prompt).toContain('test-freeform-playable.mjs')
    expect(prompt).not.toContain('Three.js')
    expect(prompt).not.toContain('test-playable.mjs')
    expect(prompt).not.toContain('already seeded from that source')
  })

  it('tells approximate builds to modify the prebuilt baseline without rebuilding it', () => {
    const prompt = createCodexBuildPrompt('approximate')

    expect(prompt).toContain('prebuilt output.html baseline')
    expect(prompt).toContain('Do not run the registered template build command')
    expect(prompt).toContain('test-freeform-playable.mjs')
  })

  it.each([undefined, 'dragon_slots' as const])(
    'keeps static artifact validation while omitting browser acceptance when full validation is disabled: %s',
    (sourceTemplateId) => {
      const prompt = createCodexBuildPrompt('exact', undefined, sourceTemplateId, 'center_collision', {
        validationEnabled: false,
      })

      expect(prompt).toContain('full Codex validation is disabled')
      expect(prompt).toContain('Do not run browser acceptance')
      expect(prompt).not.toContain('test-playable.mjs')
      expect(prompt).toContain('test-freeform-playable.mjs')
      expect(prompt).not.toContain('work/validation-checklist.md')
    },
  )

  it('tells 3D builds to adapt the current Three.js template without replacing its gameplay skeleton', () => {
    const prompt = createCodexBuildPrompt('exact', undefined, undefined, 'perspective_3d')

    expect(prompt).toContain('current perspective_3d template')
    expect(prompt).toContain('Three.js/WebGL')
    expect(prompt).toContain('8x8 outer ring')
    expect(prompt).toContain('Do not replace it with the shared Canvas 2D runtime')
    expect(prompt).toContain('Apply uploaded assets and confirmed changes in place')
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

  it.each([undefined, 'medium'] as const)(
    'uses configured reasoning (%s) with structured output and no Sandbox',
    async (effort) => {
      vi.stubEnv('PLAYABLE_REQUIREMENT_REASONING_EFFORT', effort)
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

      expect(responseMocks.createOpenAI).toHaveBeenCalledWith({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      expect(responseMocks.responses).toHaveBeenCalledWith('openai/gpt-5.6-sol')
      const settings = responseMocks.streamText.mock.calls[0][0] as {
        model: unknown
        instructions: string
        prompt: string
        providerOptions: { openai: Record<string, unknown> }
      }
      expect(settings.model).toBe(responseMocks.model)
      expect(settings.instructions).toContain('domain tools')
      expect(settings.instructions).toContain('respond_to_user')
      expect(settings.instructions).toContain('present_market_research')
      expect(settings.instructions).toContain('not from keywords or fixed query categories')
      expect(settings.instructions).toContain('update_requirement_brief')
      expect(settings.instructions).toContain('validate_implementation_route')
      expect(settings.instructions).toContain('freeform')
      expect(settings.instructions).toContain('AI media generation is unavailable')
      expect(settings.providerOptions.openai).toEqual({
        forceReasoning: true,
        reasoningEffort: effort ?? 'high',
        reasoningSummary: 'auto',
        store: false,
        strictJsonSchema: true,
      })
      expect(settings.prompt).not.toContain(apiKey)
      expect(settings.prompt).toContain('"attachedAssetIds":["current-image"]')
      expect(onProgress).toHaveBeenCalledWith({ message: confirmationOutput.message, reasoning: undefined })
      expect(harnessMocks.createVercelSandbox).not.toHaveBeenCalled()
      expect(harnessMocks.createSession).not.toHaveBeenCalled()
    },
  )

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

  it('lets the agent summarize successful market research without presenting selectable directions', async () => {
    const searchBrief = researchReport.brief
    responseMocks.streamText
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve({
          kind: 'tool_calls',
          message: null,
          reasoning: '用户的问题需要公开市场资料。',
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
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve({
          kind: 'terminal',
          message: null,
          reasoning: '用户当前只需要研究结论，无需选择构建方向。',
          toolCalls: [],
          plan: {
            message: '公开案例显示，近期同类试玩更强调快速进入首次交互。',
            reasoning: '根据搜索结果直接回答用户。',
            calls: [
              {
                name: 'respond_to_user',
                brief: null,
                annotations: null,
                request: null,
                confirmation: null,
                revision: null,
              },
            ],
          },
        }),
      } as never)
    const executeTool = vi.fn(async () => researchReport)

    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'task-research', prompt: '搜索同类试玩', apiKey: 'sk-unit-test-only' },
        { executeTool },
      ),
    ).resolves.toMatchObject({
      kind: 'informational',
      message: '公开案例显示，近期同类试玩更强调快速进入首次交互。',
    })
    expect(executeTool).toHaveBeenCalledOnce()
    expect(responseMocks.streamText).toHaveBeenCalledTimes(2)
    const secondPrompt = (responseMocks.streamText.mock.calls[1][0] as { prompt: string }).prompt
    expect(secondPrompt).toContain('"tool":"search_market_references"')
    expect(secondPrompt).toContain('"runId":"research-run-1"')
  })

  it('presents selectable directions only when the agent explicitly chooses that response', async () => {
    const searchToolCall = {
      name: 'search_market_references' as const,
      assetIds: [],
      assetId: null,
      searchBrief: researchReport.brief,
    }
    responseMocks.streamText
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve({
          kind: 'tool_calls',
          message: null,
          reasoning: '先检索公开资料。',
          toolCalls: [searchToolCall],
          plan: null,
        }),
      } as never)
      .mockReturnValueOnce({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve({
          kind: 'terminal',
          message: null,
          reasoning: '用户准备制作试玩，选择一个方向有助于确定需求。',
          toolCalls: [],
          plan: {
            message: '我整理了几个可采纳的方向，你可以选择一个并组合亮点。',
            reasoning: '搜索结果包含可用于下一步需求决策的方向。',
            calls: [
              {
                name: 'present_market_research',
                brief: null,
                annotations: null,
                request: null,
                confirmation: null,
                revision: null,
              },
            ],
          },
        }),
      } as never)
    const executeTool = vi.fn(async () => researchReport)

    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'task-research-directions', prompt: '帮我找些参考并决定做什么', apiKey: 'sk-unit-test-only' },
        { executeTool },
      ),
    ).resolves.toMatchObject({
      kind: 'research',
      message: '我整理了几个可采纳的方向，你可以选择一个并组合亮点。',
      research: researchReport,
    })
    expect(responseMocks.streamText).toHaveBeenCalledTimes(2)
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
    responseMocks.streamText.mockReturnValue({
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

  // 人为缺少能力检查，验证能定位流程规则，而不是静默补齐模型遗漏的步骤。
  it('identifies the missing capabilities check in a jump-repair revision without changing the plan', async () => {
    const plan = {
      ...confirmationOutput,
      calls: [
        confirmationOutput.calls[0],
        {
          ...confirmationOutput.calls[3],
          name: 'submit_revision',
          revision: {
            requestedBaseVersion: null,
            parameterOnly: false,
            strategy: 'patch',
            summary: '修复跳转',
            changes: ['恢复原生下载跳转'],
            preserved: ['保留现有玩法'],
          },
        },
      ],
    }
    responseMocks.streamText.mockReturnValue({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve(plan),
    } as never)
    await expect(
      new CodexPlayableAgent().proposeConfirmation({
        taskId: 'repair-jump',
        prompt: '跳转没了',
        apiKey: 'sk-unit-only',
        hasArtifact: true,
        brief: requirementBrief,
      }),
    ).rejects.toMatchObject({
      code: 'output_invalid',
      diagnostic: { stage: 'plan_execution', step: 2, rule: 'revision_capabilities_missing', issues: [] },
    })
    expect(responseMocks.streamText).toHaveBeenCalledTimes(2)
  })

  // 相同 freeform/template 输出，仅宿主加载了 HTML 时可通过，防止把例外扩展到普通新建任务。
  it.each([false, true])(
    'allows native freeform rendering only for a host-loaded HTML source: %s',
    async (hasSource) => {
      const brief = {
        ...requirementBrief,
        routing: { ...requirementBrief.routing, match: 'freeform' as const, differences: ['保留上传的 Cocos 引擎'] },
      }
      const proposed = {
        ...validProposal,
        routing: {
          match: brief.routing.match,
          confidence: brief.routing.confidence,
          differences: brief.routing.differences,
        },
        rendering: { renderer: 'template', physics: 'template', reason: '保留上传 HTML 的 Cocos 引擎' },
      }
      const plan = {
        ...confirmationOutput,
        calls: [
          { ...confirmationOutput.calls[0], brief },
          confirmationOutput.calls[1],
          {
            ...confirmationOutput.calls[3],
            name: 'submit_revision',
            confirmation: proposed,
            revision: {
              requestedBaseVersion: null,
              parameterOnly: false,
              strategy: 'patch',
              summary: '修复跳转',
              changes: ['恢复原生下载跳转'],
              preserved: ['保留 Cocos 引擎和现有玩法'],
            },
          },
        ],
      }
      responseMocks.streamText.mockReturnValue({
        fullStream: (async function* () {})(),
        partialOutputStream: (async function* () {})(),
        output: Promise.resolve(plan),
      } as never)
      const result = new CodexPlayableAgent().proposeConfirmation({
        taskId: 'repair-native-jump',
        prompt: '跳转没了',
        apiKey: 'sk-unit-only',
        hasArtifact: true,
        brief,
        ...(hasSource
          ? {
              sourceHtml: {
                assetId: 'host-source',
                filename: 'source.html',
                html: '<canvas></canvas>',
                truncated: false,
              },
            }
          : {}),
      })
      if (hasSource) {
        const reply = await result
        expect(reply).toMatchObject({
          kind: 'revision',
          revision: { strategy: 'patch' },
          confirmation: { routing: { match: 'freeform' } },
        })
        if (reply.kind === 'revision') expect(reply.confirmation.rendering).toBeUndefined()
      } else {
        await expect(result).rejects.toMatchObject({
          code: 'output_invalid',
          diagnostic: {
            stage: 'plan_execution',
            issues: [{ code: 'custom', path: ['rendering'], rule: 'freeform_template_renderer' }],
          },
        })
      }
    },
  )

  // 持续返回合法工具调用但不结束，也应被识别为轮数耗尽，而非字段格式错误。
  it.each([undefined, '3'])('records step exhaustion at the configured budget (%s)', async (configuredSteps) => {
    vi.stubEnv('PLAYABLE_REQUIREMENT_MAX_STEPS', configuredSteps)
    const expectedSteps = configuredSteps ? Number(configuredSteps) : 20
    responseMocks.streamText.mockImplementation(
      () =>
        ({
          fullStream: (async function* () {})(),
          partialOutputStream: (async function* () {})(),
          output: Promise.resolve({
            kind: 'tool_calls',
            message: null,
            reasoning: '查看版本',
            plan: null,
            toolCalls: [{ name: 'read_playable_version', version: 1, assetIds: [], assetId: null, searchBrief: null }],
          }),
        }) as never,
    )
    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'repair-jump', prompt: '跳转没了', apiKey: 'sk-unit-only', hasArtifact: true },
        { executeTool: async () => ({ status: 'completed' }) },
      ),
    ).rejects.toMatchObject({
      code: 'output_invalid',
      diagnostic: { stage: 'step_limit', step: expectedSteps, rule: 'step_limit_reached' },
    })
    expect(responseMocks.streamText).toHaveBeenCalledTimes(expectedSteps)
  })

  it('can finish on the final allowed decision after more than six steps', async () => {
    vi.stubEnv('PLAYABLE_REQUIREMENT_MAX_STEPS', '7')
    let step = 0
    responseMocks.streamText.mockImplementation(() => ({
      fullStream: (async function* () {})(),
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve(
        ++step === 7
          ? confirmationOutput
          : {
              kind: 'tool_calls',
              message: null,
              reasoning: '查看参考版本',
              plan: null,
              toolCalls: [
                { name: 'read_playable_version', version: step, assetIds: [], assetId: null, searchBrief: null },
              ],
            },
      ),
    }))
    const executeTool = vi.fn(async () => ({ status: 'completed' }))
    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'long-requirement', prompt: '比较参考版本后整理需求', apiKey: 'unit-key' },
        { executeTool },
      ),
    ).resolves.toMatchObject(confirmationReply)
    expect(responseMocks.streamText).toHaveBeenCalledTimes(7)
    expect(executeTool).toHaveBeenCalledTimes(6)
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

  it('honors an externally cancelled requirement request before invoking the model', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new CodexPlayableAgent().proposeConfirmation(
        { taskId: 'cancelled-replay', apiKey: 'unit-key', prompt: '修改文案' },
        { abortSignal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(responseMocks.streamText).not.toHaveBeenCalled()
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

  it('retries the full isolated build after a transient Codex overload interruption', async () => {
    const buildResult: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const overload = new PlayableBuildExecutionError(
      'agent',
      'Reconnecting... 1/5 (stream disconnected before completion: Our servers are currently overloaded. Please try again later.)',
    )
    const buildRunner = vi.fn().mockRejectedValueOnce(overload).mockResolvedValueOnce(buildResult)
    const buildRetryDelay = vi.fn(async () => undefined)
    const agent = new CodexPlayableAgent({ buildRunner, buildRetryDelay })

    await expect(
      agent.build({
        taskId: 'task-overloaded',
        apiKey: 'sk-build-test',
        confirmation: validProposal,
      }),
    ).resolves.toBe(buildResult)

    expect(buildRunner).toHaveBeenCalledTimes(2)
    expect(buildRetryDelay).toHaveBeenCalledOnce()
    expect(buildRunner.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ taskId: 'task-overloaded-retry-2' }))
  })

  it('does not retry a non-transient Codex build failure', async () => {
    const failure = new PlayableBuildExecutionError('agent', new Error('codex turn failed'))
    const buildRunner = vi.fn().mockRejectedValueOnce(failure)
    const buildRetryDelay = vi.fn(async () => undefined)
    const agent = new CodexPlayableAgent({ buildRunner, buildRetryDelay })

    await expect(
      agent.build({
        taskId: 'task-failed',
        apiKey: 'sk-build-test',
        confirmation: validProposal,
      }),
    ).rejects.toBe(failure)

    expect(buildRunner).toHaveBeenCalledOnce()
    expect(buildRetryDelay).not.toHaveBeenCalled()
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

it('preserves the execution timeout when session cleanup also fails', async () => {
  const original = new DOMException('Timed out', 'TimeoutError')
  harnessMocks.stream.mockRejectedValueOnce(original)
  harnessMocks.destroy.mockRejectedValueOnce(new Error('command_not_found_or_exited'))
  await expect(
    executeBuildAgent(
      {
        taskId: 'cleanup-test',
        sandbox: {} as PlayableSandbox,
        authEnvironment: { CODEX_API_KEY: 'sk-unit-test', OPENAI_BASE_URL: 'https://openrouter.ai/api/v1' },
      },
      `${process.cwd()}/skills/mahjong-pair-match-playable`,
      'exact',
      undefined,
    ),
  ).rejects.toBe(original)
})

// Sent in every phase: the self-comparison runs after acceptance.
it('passes the reference visuals prompt to the build agent', async () => {
  const stopped = new Error('stopped after prompt')
  harnessMocks.stream.mockRejectedValueOnce(stopped)
  await expect(
    executeBuildAgent(
      {
        phase: 'acceptance',
        taskId: 'visual-prompt-test',
        sandbox: {} as PlayableSandbox,
        authEnvironment: { CODEX_API_KEY: 'sk-unit-test', OPENAI_BASE_URL: 'https://openrouter.ai/api/v1' },
      },
      `${process.cwd()}/skills/mahjong-pair-match-playable`,
      'approximate',
      undefined,
      undefined,
      'center_collision',
      undefined,
      'VISUAL TARGET PROMPT',
    ),
  ).rejects.toBe(stopped)
  const lastCall = harnessMocks.stream.mock.lastCall as unknown as [{ prompt: string }] | undefined
  expect(lastCall?.[0].prompt).toContain('VISUAL TARGET PROMPT')
})
