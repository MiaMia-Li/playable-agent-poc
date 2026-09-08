import { describe, expect, it } from 'vitest'
import { createCodexBuildAgent } from '@/lib/playable/codex-playable-agent'

describe('Codex Harness build configuration', () => {
  it('constructs with the real Codex Harness without unsupported built-in tool filtering', () => {
    expect(() =>
      createCodexBuildAgent({
        apiKey: 'test-only-key',
        skill: {
          name: 'test-playable-skill',
          description: 'Test-only playable build skill.',
          content: 'Build the confirmed playable.',
          files: [],
        },
      }),
    ).not.toThrow()
  })
})
