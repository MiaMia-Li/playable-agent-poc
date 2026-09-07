import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalDemoMode, localDemoRuntime } from '@/lib/playable/local-demo-prototype'
import type { PlayableModeId } from '@/lib/playable/types'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local demo prototype', () => {
  it('selects each supported mode from a short requirement', async () => {
    const cases: Array<[string, PlayableModeId]> = [
      ['中心碰撞玩法', 'center_collision'],
      ['使用上方牌架', 'top_rack'],
      ['消除后下落补位', 'gravity_fill'],
      ['制作 3D 立体牌墙', 'perspective_3d'],
    ]

    for (const [prompt, mode] of cases) {
      const proposal = await localDemoRuntime.agent.proposeConfirmation({
        taskId: 'local-task',
        prompt,
        apiKey: 'sk-test-local-demo',
      })
      expect(proposal.mode).toBe(mode)
    }
  })

  it('builds and behavior-checks an offline playable with the vendored Skill', async () => {
    const confirmation = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-task',
      prompt: '使用上方牌架',
      apiKey: 'sk-test-local-demo',
    })
    const result = await localDemoRuntime.agent.build({
      taskId: 'local-task',
      apiKey: 'sk-test-local-demo',
      confirmation,
      assets: [],
    })

    expect(result.validation.behavior).toBe('passed')
    expect(result.validation.bytes).toBeLessThan(5 * 1024 * 1024)
    expect(result.html).toContain('window.__PLAYABLE__')
    expect(result.html).not.toContain('sk-test-local-demo')
  })

  it('cannot bypass authentication in production', () => {
    vi.stubEnv('LOCAL_DEMO_MODE', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(isLocalDemoMode()).toBe(false)
  })
})
