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
    { name: 'update_requirement_brief', brief, request: null, confirmation: null },
    { name: 'list_playable_capabilities', brief: null, request: null, confirmation: null },
    { name: 'validate_implementation_route', brief: null, request: null, confirmation: null },
    { name: 'submit_confirmation', brief: null, request: null, confirmation: proposal },
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
        { taskId: 'task-cli', prompt: '做一个中心碰撞玩法', apiKey: 'local-marker' },
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
    expect(onProgress).toHaveBeenCalledWith({ reasoning: '正在整理需求与实现路线。' })
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
})
