import { triangleGlb } from '../fixtures/glb'
import { sourceTemplateIds } from '@/lib/playable/types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildResult, ConfirmedBuildInput } from '@/lib/playable/playable-agent-adapter'
import { CodexCliPlayableAgent } from '@/lib/playable/codex-cli-playable-agent'
import { createValidationReport } from '@/lib/playable/production-contract'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import { LocalDemoMarketResearchAgent } from '@/lib/playable/research/local-demo-market-research-agent'
import { defaultConfirmationPresentation } from '@/lib/playable/schemas'

const proposal = {
  visualDirection: 'custom' as const,
  routing: { match: 'exact', confidence: 1, differences: [] as string[] },
  presentation: defaultConfirmationPresentation,
  mode: 'center_collision',
  gameplay: '相同牌向中心碰撞并消除',
  resources: {
    tileFaces: { status: '内置默认', treatment: '内置麻将牌面' },
    backgroundBoard: { status: '内置默认', treatment: '内置棋盘背景' },
    animationEffects: { status: '内置默认', treatment: '内置碰撞特效' },
    audio: { status: '内置默认', treatment: '内置音效' },
    endCard: { status: '内置默认', treatment: '内置结束卡' },
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
  reasoning: '玩法已经明确。',
  confirmation: proposal,
} as const

const brief = {
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

const confirmationPlan = {
  message: confirmationReply.message,
  reasoning: confirmationReply.reasoning,
  calls: [
    { name: 'update_requirement_brief', annotations: null, brief, request: null, confirmation: null, revision: null },
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
      confirmation: proposal,
      revision: null,
    },
  ],
} as const

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CodexCliPlayableAgent', () => {
  it('uses a read-only Codex invocation and validates the structured proposal', async () => {
    const invokeCodex = vi.fn(async (...args: unknown[]) => {
      const invocation = args[0] as {
        onEvent?: (event: { type: string; item: { type: string; text: string } }) => void
      }
      invocation.onEvent?.({
        type: 'item.completed',
        item: { type: 'reasoning', text: '正在整理需求与实现路线。' },
      })
      return confirmationPlan
    })
    const agent = new CodexCliPlayableAgent({ invokeCodex })
    const onProgress = vi.fn()

    await expect(
      agent.proposeConfirmation(
        {
          taskId: 'task-cli',
          prompt: '做一个中心碰撞玩法',
          apiKey: 'local-marker',
          attachedAssetIds: ['current-video'],
        },
        { onProgress },
      ),
    ).resolves.toMatchObject(confirmationReply)

    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: 'read-only',
        reasoningEffort: 'low',
        prompt: expect.stringContaining('<conversation-context>'),
      }),
    )
    const calls = invokeCodex.mock.calls as unknown as Array<[{ schema: Record<string, unknown>; prompt: string }]>
    const invocation = calls[0][0]
    expect(JSON.stringify(invocation.schema)).not.toContain('"oneOf"')
    expect(invocation.prompt).toContain('domain tools')
    expect(invocation.prompt).toContain('respond_to_user')
    expect(invocation.prompt).toContain('present_market_research')
    expect(invocation.prompt).toContain('not from keywords or fixed query categories')
    expect(invocation.prompt).toContain('update_requirement_brief')
    expect(invocation.prompt).toContain('exact when a template fully covers')
    expect(invocation.prompt).toContain('freeform')
    expect(invocation.prompt).toContain('AI media generation is unavailable')
    expect(invocation.prompt).toContain('"attachedAssetIds":["current-video"]')
    expect(onProgress).toHaveBeenCalledWith({ reasoning: '正在整理需求与实现路线。' })
  })

  it('uses the same multi-step reference analysis loop and reports failed tool execution', async () => {
    const toolCall = {
      name: 'analyze_reference_video' as const,
      assetIds: [],
      assetId: 'video-1',
      searchBrief: null,
    }
    const invokeCodex = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        message: null,
        reasoning: '需要分析视频中的玩法。',
        toolCalls: [toolCall],
        plan: null,
      })
      .mockResolvedValueOnce({
        kind: 'terminal',
        message: null,
        reasoning: '工具失败后安全询问用户。',
        toolCalls: [],
        plan: confirmationPlan,
      })
    const executeTool = vi.fn(async () => {
      throw new Error('private executor detail')
    })
    const onProgress = vi.fn()

    await expect(
      new CodexCliPlayableAgent({ invokeCodex }).proposeConfirmation(
        { taskId: 'task-cli-analysis', prompt: '参考视频制作玩法', apiKey: 'local-marker' },
        { executeTool, onProgress },
      ),
    ).resolves.toMatchObject(confirmationReply)

    expect(invokeCodex).toHaveBeenCalledTimes(2)
    const calls = invokeCodex.mock.calls as unknown as Array<[{ prompt: string }]>
    expect(calls[1][0].prompt).toContain('"status":"failed"')
    expect(calls[1][0].prompt).not.toContain('private executor detail')
    expect(executeTool).toHaveBeenCalledWith(toolCall, {
      abortSignal: expect.any(AbortSignal),
    })
    expect(onProgress).toHaveBeenCalledWith({ type: 'tool_started', toolCall })
    expect(onProgress).toHaveBeenCalledWith({ type: 'tool_failed', toolCall })
  })

  it('lets Codex decide how to present a completed market search on a second model step', async () => {
    const searchBrief = {
      version: 1 as const,
      trigger: 'explicit' as const,
      category: '休闲游戏',
      subcategory: '颜色分类倒瓶',
      gameplayKeywords: ['颜色分类'],
      market: '全球',
      locale: 'zh-CN',
      adNetwork: 'AppLovin',
      timeRange: '最近 90 天',
      focusAreas: ['玩法结构'],
      requirementSummary: '研究公开参考',
    }
    const report = await new LocalDemoMarketResearchAgent().search({
      runId: 'cli-research-run',
      apiKey: 'local-marker',
      brief: searchBrief,
    })
    const invokeCodex = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        message: null,
        reasoning: '需要先搜索公开资料。',
        toolCalls: [
          {
            name: 'search_market_references',
            assetIds: [],
            assetId: null,
            searchBrief,
          },
        ],
        plan: null,
      })
      .mockResolvedValueOnce({
        kind: 'terminal',
        message: null,
        reasoning: '搜索结果适合直接回答。',
        toolCalls: [],
        plan: {
          message: '我根据公开资料整理了适合倒瓶玩法的结构建议。',
          reasoning: '无需展示可选择方向。',
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
      })
    const executeTool = vi.fn(async () => report)

    await expect(
      new CodexCliPlayableAgent({ invokeCodex }).proposeConfirmation(
        { taskId: 'task-cli-research', prompt: '找一些颜色分类倒瓶的参考', apiKey: 'local-marker' },
        { executeTool },
      ),
    ).resolves.toMatchObject({
      kind: 'informational',
      message: '我根据公开资料整理了适合倒瓶玩法的结构建议。',
    })
    expect(invokeCodex).toHaveBeenCalledTimes(2)
    const calls = invokeCodex.mock.calls as unknown as Array<[{ prompt: string }]>
    expect(calls[1][0].prompt).toContain('"tool":"search_market_references"')
    expect(calls[1][0].prompt).toContain('"runId":"cli-research-run"')
  })

  it('stops after six model steps when analysis never reaches a terminal reply', async () => {
    const invokeCodex = vi.fn(async () => ({
      kind: 'tool_calls',
      message: null,
      reasoning: '继续分析。',
      toolCalls: [{ name: 'inspect_reference_images', assetIds: ['image-1'], assetId: null, searchBrief: null }],
      plan: null,
    }))
    const executeTool = vi.fn(async () => ({ observations: [] }))

    await expect(
      new CodexCliPlayableAgent({ invokeCodex }).proposeConfirmation(
        { taskId: 'task-cli-step-limit', prompt: '持续分析', apiKey: 'local-marker' },
        { executeTool },
      ),
    ).rejects.toMatchObject({ code: 'output_invalid' })

    expect(invokeCodex).toHaveBeenCalledTimes(6)
    expect(executeTool).toHaveBeenCalledOnce()
  })

  it('runs Codex with workspace writes before delegating the isolated build', async () => {
    const onActivity = vi.fn()
    const invokeCodex = vi.fn(async (invocation) => {
      const references = JSON.parse(await readFile(path.join(invocation.workspace, 'reference-images.json'), 'utf8'))
      expect(references[0]).toMatchObject({
        sourceVersion: 2,
        purpose: 'problem',
        workspacePath: 'reference-images/1.png',
      })
      expect(new Uint8Array(await readFile(path.join(invocation.workspace, 'reference-images/1.png')))).toEqual(
        new Uint8Array([1, 2]),
      )
      const resources = await readFile(path.join(invocation.workspace, 'asset-manifest.json'), 'utf8')
      expect(resources).not.toContain('reference-images')
      expect(JSON.parse(resources).assets[0]).toMatchObject({
        mimeType: 'model/gltf-binary',
        model: { meshes: 1 },
        workspacePath: 'user-assets/tileFaces/model-block.glb',
      })
      expect(await readFile(path.join(invocation.workspace, 'user-assets/tileFaces/model-block.glb'))).toEqual(
        Buffer.from(triangleGlb()),
      )
      expect(invocation.prompt).toContain('not game assets')
      invocation.onEvent?.({ type: 'item.started', item: { type: 'command_execution', command: 'private command' } })
      invocation.onEvent?.({ type: 'item.completed', item: { type: 'command_execution', exit_code: 0 } })
      return { completed: true }
    })
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const buildRunner = vi.fn(async () => result)
    const input: ConfirmedBuildInput = {
      taskId: 'task-cli-build',
      assets: [
        {
          id: 'model',
          slot: 'tileFaces',
          filename: 'block.glb',
          mimeType: 'model/gltf-binary',
          bytes: triangleGlb(),
          size: triangleGlb().length,
        },
      ],
      onActivity,
      apiKey: 'local-marker',
      confirmation: proposal,
      referenceImages: [
        {
          assetId: 'ref',
          filename: 'ref.png',
          mimeType: 'image/png',
          sourceBuildId: 'v2',
          sourceVersion: 2,
          purpose: 'problem',
          description: 'Extra row',
          bytes: new Uint8Array([1, 2]),
        },
      ],
    }

    await expect(new CodexCliPlayableAgent({ invokeCodex, buildRunner }).build(input)).resolves.toBe(result)
    expect(onActivity.mock.calls.map(([activity]) => activity)).toEqual([
      'preparing',
      'transferring',
      'agent_started',
      'command_started',
      'command_completed',
      'agent_completed',
    ])
    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: 'workspace-write',
        reasoningEffort: 'medium',
        prompt: expect.stringContaining('confirmed-config.json'),
      }),
    )
    expect(buildRunner).toHaveBeenCalledWith(input, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }))
  })

  it('skips Codex CLI validation instructions when sandbox validation is disabled', async () => {
    vi.stubEnv('PLAYABLE_SANDBOX_VALIDATION_ENABLED', '0')
    const invokeCodex = vi.fn(async () => ({ completed: true }))
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }

    await new CodexCliPlayableAgent({ invokeCodex, buildRunner: vi.fn(async () => result) }).build({
      taskId: 'task-cli-validation-disabled',
      apiKey: 'local-marker',
      confirmation: proposal,
    })

    const calls = invokeCodex.mock.calls as unknown as Array<[{ prompt: string }]>
    expect(calls[0][0].prompt).toContain('full Codex validation is disabled')
    expect(calls[0][0].prompt).not.toContain('test-playable.mjs')
    expect(calls[0][0].prompt).not.toContain('work/validation-checklist.md')
  })

  it.each(
    sourceTemplateIds.flatMap((sourceTemplateId) =>
      ([undefined, 'patch', 'regenerate'] as const).map((strategy) => ({ sourceTemplateId, strategy })),
    ),
  )('CLI 模板基线：$sourceTemplateId / $strategy', async ({ sourceTemplateId, strategy }) => {
    const source = '<html><body>original template</body></html>'
    let inspected = false
    const invokeCodex = vi.fn(async (invocation) => {
      expect(await readFile(path.join(invocation.workspace, 'output.html'), 'utf8')).toBe(source)
      expect(await readFile(path.join(invocation.workspace, 'current-playable.html'), 'utf8')).toBe(source)
      expect(invocation.prompt).toContain('Modify output.html in place')
      expect(invocation.prompt).not.toContain('Create the requested game directly')
      expect(invocation.prompt).not.toContain('Three.js')
      expect(invocation.prompt).toContain('test-freeform-playable.mjs')
      if (strategy === 'patch') expect(invocation.prompt).toContain('Copy current-playable.html to output.html')
      inspected = true
      return { completed: true }
    })
    const result: BuildResult = {
      html: source,
      validation: createValidationReport({ bytes: source.length, offlineResources: true, responsiveViewport: true }),
    }
    await new CodexCliPlayableAgent({ invokeCodex, buildRunner: vi.fn(async () => result) }).build({
      taskId: 'template-task',
      ...(strategy
        ? {
            revision: {
              id: 'revision',
              baseBuildId: 'base',
              baseVersion: 1,
              targetVersion: 2,
              strategy,
              summary: '修改游戏',
              changes: ['调整交互'],
              preserved: ['保留引擎'],
            },
          }
        : {}),
      apiKey: 'local-marker',
      baseHtml: source,
      confirmation: {
        ...proposal,
        sourceTemplateId,
        mode: 'perspective_3d',
        routing: { match: 'freeform', confidence: 1, differences: ['Adapt source'] },
      },
    })
    expect(inspected).toBe(true)
  })

  it('asks Codex to create output.html directly for a freeform route', async () => {
    const invokeCodex = vi.fn(async () => ({ completed: true }))
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const buildRunner = vi.fn(async () => result)

    await new CodexCliPlayableAgent({ invokeCodex, buildRunner }).build({
      taskId: 'task-cli-freeform',
      apiKey: 'local-marker',
      confirmation: {
        ...proposal,
        routing: { match: 'freeform', confidence: 0.1, differences: ['状态机不受支持'] },
        gameplay: '自由移动并击败 Boss',
      },
    })

    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('Create the requested game directly in output.html') }),
    )
  })

  it('asks Codex to adapt every confirmed difference for an approximate route', async () => {
    const invokeCodex = vi.fn(async () => ({ completed: true }))
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }

    await new CodexCliPlayableAgent({ invokeCodex, buildRunner: vi.fn(async () => result) }).build({
      taskId: 'task-cli-approximate',
      apiKey: 'local-marker',
      confirmation: {
        ...proposal,
        routing: { match: 'approximate', confidence: 0.7, differences: ['增加 Boss 奖励表现'] },
      },
    })

    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('implement every confirmed routing difference') }),
    )
  })

  it('asks Codex CLI to use the current 3D template as the adaptation baseline', async () => {
    const invokeCodex = vi.fn(async () => ({ completed: true }))
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }

    await new CodexCliPlayableAgent({ invokeCodex, buildRunner: vi.fn(async () => result) }).build({
      taskId: 'task-cli-perspective-3d',
      apiKey: 'local-marker',
      confirmation: { ...proposal, mode: 'perspective_3d' },
    })

    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('current perspective_3d template'),
      }),
    )
    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Do not replace it with the shared Canvas 2D runtime'),
      }),
    )
  })
})
