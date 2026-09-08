import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalDemoMode, localDemoRuntime } from '@/lib/playable/local-demo-prototype'
import type { PlayableModeId } from '@/lib/playable/types'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local demo prototype', () => {
  it('collects gameplay, asset strategy, and launch details before returning a confirmation', async () => {
    const gameplayReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '制作一个麻将消消乐',
      apiKey: 'sk-test-local-demo',
    })
    expect(gameplayReply.kind).toBe('clarification')
    if (gameplayReply.kind !== 'clarification') throw new Error('Expected gameplay clarification')

    const themeReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: 'center_collision',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
      ],
    })

    expect(themeReply.kind).toBe('clarification')
    if (themeReply.kind !== 'clarification') throw new Error('Expected theme clarification')
    expect(themeReply.message).toContain('视觉主题')

    const assetReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '经典国风主题',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
        { role: 'user', content: 'center_collision' },
        { role: 'assistant', content: themeReply.message },
      ],
    })

    expect(assetReply.kind).toBe('clarification')
    if (assetReply.kind !== 'clarification') throw new Error('Expected asset clarification')
    expect(assetReply.message).toContain('素材')

    const launchReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '全部使用内置默认素材',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
        { role: 'user', content: 'center_collision' },
        { role: 'assistant', content: themeReply.message },
        { role: 'user', content: '经典国风主题' },
        { role: 'assistant', content: assetReply.message },
      ],
    })

    expect(launchReply.kind).toBe('clarification')
    if (launchReply.kind !== 'clarification') throw new Error('Expected launch clarification')
    expect(launchReply.message).toMatch(/文案|链接/)

    const confirmationReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '使用默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
        { role: 'user', content: 'center_collision' },
        { role: 'assistant', content: themeReply.message },
        { role: 'user', content: '经典国风主题' },
        { role: 'assistant', content: assetReply.message },
        { role: 'user', content: '全部使用内置默认素材' },
        { role: 'assistant', content: launchReply.message },
      ],
    })

    expect(confirmationReply.kind).toBe('confirmation')
  })

  it('selects each supported mode from a short requirement', async () => {
    const cases: Array<[string, PlayableModeId]> = [
      ['经典国风主题，中心碰撞玩法，使用内置默认素材、默认文案和测试链接', 'center_collision'],
      ['经典国风主题，使用上方牌架、内置默认素材、默认文案和测试链接', 'top_rack'],
      ['经典国风主题，消除后下落补位，使用内置默认素材、默认文案和测试链接', 'gravity_fill'],
      ['经典国风主题，制作 3D 立体牌墙，使用内置默认素材、默认文案和测试链接', 'perspective_3d'],
    ]

    for (const [prompt, mode] of cases) {
      const reply = await localDemoRuntime.agent.proposeConfirmation({
        taskId: 'local-task',
        prompt,
        apiKey: 'sk-test-local-demo',
      })
      expect(reply.kind).toBe('confirmation')
      if (reply.kind === 'confirmation') expect(reply.confirmation.mode).toBe(mode)
    }
  })

  it('builds and behavior-checks an offline playable with the vendored Skill', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-task',
      prompt: '经典国风主题，使用上方牌架、内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    const result = await localDemoRuntime.agent.build({
      taskId: 'local-task',
      apiKey: 'sk-test-local-demo',
      confirmation: reply.confirmation,
      assets: [],
    })

    expect(result.validation.behavior).toBe('passed')
    expect(result.validation.bytes).toBeLessThan(5 * 1024 * 1024)
    expect(result.html).toContain('window.__PLAYABLE__')
    expect(result.html).not.toContain('sk-test-local-demo')
  })

  it('simulates selected AI media offline instead of calling OpenAI', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-media-task',
      prompt: '经典国风主题，使用中心碰撞玩法、内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    const confirmation = {
      ...reply.confirmation,
      resources: {
        ...reply.confirmation.resources,
        backgroundBoard: { status: '待生成' as const, treatment: '生成农场背景' },
        audio: { status: '待生成' as const, treatment: '生成欢快配音' },
      },
    }

    const assets = await localDemoRuntime.mediaGenerator({
      taskId: 'local-media-task',
      apiKey: 'sk-test-local-demo',
      confirmation,
    })

    expect(assets.map((asset) => asset.slot)).toEqual(['backgroundBoard', 'audio'])
    expect(assets.every((asset) => asset.bytes.byteLength > 0)).toBe(true)
  })

  it('carries the collected AI asset strategy into the final confirmation table', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-generated-plan',
      prompt: '经典国风主题，中心碰撞玩法，图片和音频素材全部使用 AI 生成，使用默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })

    expect(reply.kind).toBe('confirmation')
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    expect(Object.values(reply.confirmation.resources).every((resource) => resource.status === '待生成')).toBe(true)
  })

  it('cannot bypass authentication in production', () => {
    vi.stubEnv('LOCAL_DEMO_MODE', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(isLocalDemoMode()).toBe(false)
  })
})
