import { describe, expect, it, vi } from 'vitest'
import {
  checkReplayAssertions,
  exportRequirementReplay,
  replayRequirementCase,
  type RequirementReplayCase,
} from '@/lib/playable/requirement-replay'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import type { PlayableAgentAdapter } from '@/lib/playable/playable-agent-adapter'

const brief = { ...createRequirementBrief(), constraints: ['保留胜利动画'] }
const sample: RequirementReplayCase = {
  id: 'preserve-animation',
  source: 'synthetic',
  contextReviewed: true,
  input: {
    prompt: '只把按钮改成红色',
    history: [],
    brief,
    confirmation: null,
    pendingRevision: null,
    hasArtifact: false,
  },
  toolSnapshots: [],
  assertions: [{ path: ['brief', 'constraints'], operator: 'contains', value: '保留胜利动画' }],
}
const reply = { kind: 'informational' as const, message: '已理解', reasoning: '已有约束继续保留', brief }

describe('requirement conversation replay', () => {
  it('detects a dropped constraint and never treats a missing field as a passing negative check', () => {
    expect(checkReplayAssertions({ ...reply, brief: { ...brief, constraints: [] } }, sample.assertions)).toEqual([
      false,
    ])
    expect(
      checkReplayAssertions({}, [{ path: ['brief', 'constraints'], operator: 'not_contains', value: '新增要求' }]),
    ).toEqual([false])
  })

  it.each([
    { contextReviewed: true, assertions: sample.assertions, status: 'passed' },
    { contextReviewed: false, assertions: sample.assertions, status: 'incomplete' },
    { contextReviewed: true, assertions: [], status: 'unscored' },
  ])(
    'reports $status without claiming unreviewed or unlabelled cases passed',
    async ({ contextReviewed, assertions, status }) => {
      const agent = { proposeConfirmation: vi.fn(async () => reply) }
      const result = await replayRequirementCase({ ...sample, contextReviewed, assertions }, agent, 'unit-key')
      expect(result.status).toBe(status)
      expect(agent.proposeConfirmation.mock.calls).toHaveLength(1)
    },
  )

  it('serves only recorded tool results and marks missing evidence incomplete', async () => {
    const agent: Pick<PlayableAgentAdapter, 'proposeConfirmation'> = {
      async proposeConfirmation(_input, options) {
        expect(
          await options!.executeTool!({ name: 'read_playable_version', version: 2, assetIds: [], assetId: null }),
        ).toMatchObject({ status: 'unavailable' })
        return reply
      },
    }
    const result = await replayRequirementCase(sample, agent, 'unit-key')
    expect(result).toMatchObject({ status: 'incomplete', missingToolSnapshot: true })
  })

  it('matches transport nulls to executable tool calls and returns detached snapshots', async () => {
    const toolResult = { observations: ['真实图片证据'] }
    const agent: Pick<PlayableAgentAdapter, 'proposeConfirmation'> = {
      async proposeConfirmation(_input, options) {
        const result = await options!.executeTool!({
          name: 'inspect_reference_images',
          assetIds: ['b', 'a'],
          assetId: null,
        })
        expect(result).toEqual(toolResult)
        expect(result).not.toBe(toolResult)
        return reply
      },
    }
    const result = await replayRequirementCase(
      {
        ...sample,
        toolSnapshots: [
          {
            call: {
              name: 'inspect_reference_images',
              version: null,
              assetIds: ['a', 'b'],
              assetId: null,
              searchBrief: null,
            },
            result: toolResult,
          },
        ],
      },
      agent,
      'unit-key',
    )
    expect(result.status).toBe('passed')
  })

  it('exports pre-turn state without future choices or automatically inferred grading labels', () => {
    const exported = exportRequirementReplay(
      [
        { role: 'user', content: '保留胜利动画 unit-key' },
        { role: 'agent', content: JSON.stringify(reply) },
        { role: 'user', content: '只改按钮颜色' },
        { role: 'agent', content: JSON.stringify({ ...reply, brief: { ...brief, constraints: ['后来的约束'] } }) },
      ],
      ['unit-key'],
    )
    expect(exported.cases[0].input.brief).toBeNull()
    expect(exported.cases[1].input.brief?.constraints).toEqual(['保留胜利动画'])
    expect(exported.cases[1].input.history).toHaveLength(2)
    expect(exported.cases.every((entry) => !entry.contextReviewed && entry.assertions.length === 0)).toBe(true)
    expect(JSON.stringify(exported)).not.toContain('unit-key')
    expect(JSON.stringify(exported)).not.toContain('后来的约束')
  })
})
