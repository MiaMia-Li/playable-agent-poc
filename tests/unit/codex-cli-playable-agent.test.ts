import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BuildResult, ConfirmedBuildInput } from '@/lib/playable/playable-agent-adapter'
import { CodexCliPlayableAgent } from '@/lib/playable/codex-cli-playable-agent'
import { createValidationReport } from '@/lib/playable/production-contract'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import { defaultConfirmationPresentation } from '@/lib/playable/schemas'

const proposal = {
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
    maxBytes: 5242880,
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
    { name: 'update_requirement_brief', brief, request: null, confirmation: null, revision: null },
    { name: 'list_playable_capabilities', brief: null, request: null, confirmation: null, revision: null },
    { name: 'validate_implementation_route', brief: null, request: null, confirmation: null, revision: null },
    { name: 'submit_confirmation', brief: null, request: null, confirmation: proposal, revision: null },
  ],
} as const

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
    expect(invocation.prompt).toContain('update_requirement_brief')
    expect(invocation.prompt).toContain('exact when a mode fully covers')
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
    const invokeCodex = vi.fn(async () => ({ completed: true }))
    const result: BuildResult = {
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    }
    const buildRunner = vi.fn(async () => result)
    const input: ConfirmedBuildInput = {
      taskId: 'task-cli-build',
      apiKey: 'local-marker',
      confirmation: proposal,
    }

    await expect(new CodexCliPlayableAgent({ invokeCodex, buildRunner }).build(input)).resolves.toBe(result)
    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: 'workspace-write',
        reasoningEffort: 'medium',
        prompt: expect.stringContaining('confirmed-config.json'),
      }),
    )
    expect(buildRunner).toHaveBeenCalledWith(input, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }))
  })

  it('seeds template HTML before Codex and requests in-place changes', async () => {
    const source = '<html><body>original template</body></html>'
    let inspected = false
    const invokeCodex = vi.fn(async (invocation) => {
      expect(await readFile(path.join(invocation.workspace, 'output.html'), 'utf8')).toBe(source)
      expect(await readFile(path.join(invocation.workspace, 'current-playable.html'), 'utf8')).toBe(source)
      expect(invocation.prompt).toContain('Modify output.html in place')
      expect(invocation.prompt).not.toContain('Create the requested game directly')
      inspected = true
      return { completed: true }
    })
    const result: BuildResult = {
      html: source,
      validation: createValidationReport({ bytes: source.length, offlineResources: true, responsiveViewport: true }),
    }
    await new CodexCliPlayableAgent({ invokeCodex, buildRunner: vi.fn(async () => result) }).build({
      taskId: 'template-task',
      apiKey: 'local-marker',
      baseHtml: source,
      confirmation: {
        ...proposal,
        sourceTemplateId: 'zeus_scatter',
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
