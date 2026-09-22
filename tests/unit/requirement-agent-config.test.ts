import { describe, expect, it } from 'vitest'
import { readRequirementAgentConfig } from '@/lib/playable/requirement-agent-config'

describe('requirement agent configuration', () => {
  it('defaults to twenty decisions with high reasoning effort', () => {
    expect(readRequirementAgentConfig({})).toEqual({ maxSteps: 20, reasoningEffort: 'high' })
  })

  it.each(['low', 'medium', 'high'] as const)('accepts a step override with %s reasoning', (reasoningEffort) => {
    expect(
      readRequirementAgentConfig({
        PLAYABLE_REQUIREMENT_MAX_STEPS: ' 30 ',
        PLAYABLE_REQUIREMENT_REASONING_EFFORT: ` ${reasoningEffort.toUpperCase()} `,
      }),
    ).toEqual({ maxSteps: 30, reasoningEffort })
  })

  it.each(['', '0', '-1', '2.5', 'invalid', 'Infinity', '9007199254740992'])(
    'falls back for an invalid step budget (%s) without discarding valid reasoning',
    (maxSteps) => {
      expect(
        readRequirementAgentConfig({
          PLAYABLE_REQUIREMENT_MAX_STEPS: maxSteps,
          PLAYABLE_REQUIREMENT_REASONING_EFFORT: 'medium',
        }),
      ).toEqual({ maxSteps: 20, reasoningEffort: 'medium' })
    },
  )

  it('falls back for unsupported reasoning without discarding a valid step budget', () => {
    expect(
      readRequirementAgentConfig({
        PLAYABLE_REQUIREMENT_MAX_STEPS: '1',
        PLAYABLE_REQUIREMENT_REASONING_EFFORT: 'unsupported',
      }),
    ).toEqual({ maxSteps: 1, reasoningEffort: 'high' })
  })
})
