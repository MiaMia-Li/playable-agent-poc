import { describe, expect, it, vi } from 'vitest'
import type { BuildResult, ConfirmedBuildInput } from '@/lib/playable/playable-agent-adapter'
import { CodexCliPlayableAgent } from '@/lib/playable/codex-cli-playable-agent'
import { createValidationReport } from '@/lib/playable/production-contract'

const proposal = {
  routing: { match: 'exact', confidence: 1, differences: [] as string[] },
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

describe('CodexCliPlayableAgent', () => {
  it('uses a read-only Codex invocation and validates the structured proposal', async () => {
    const invokeCodex = vi.fn(async () => ({ ...confirmationReply, options: [], pluginRequest: null }))
    const agent = new CodexCliPlayableAgent({ invokeCodex })

    await expect(
      agent.proposeConfirmation({ taskId: 'task-cli', prompt: '做一个中心碰撞玩法', apiKey: 'local-marker' }),
    ).resolves.toEqual(confirmationReply)

    expect(invokeCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: 'read-only',
        reasoningEffort: 'medium',
        prompt: expect.stringContaining('<conversation-context>'),
      }),
    )
    const calls = invokeCodex.mock.calls as unknown as Array<[{ schema: Record<string, unknown>; prompt: string }]>
    const invocation = calls[0][0]
    expect(JSON.stringify(invocation.schema)).not.toContain('"oneOf"')
    expect(invocation.prompt).toContain('Do not return confirmation until')
    expect(invocation.prompt).toContain('image and audio asset source')
    expect(invocation.prompt).toContain('HTTPS store URL')
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
})
