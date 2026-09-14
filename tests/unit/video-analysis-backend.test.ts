import { describe, expect, it } from 'vitest'
import { GeminiVideoGameplayAnalyst } from '@/lib/playable/gemini-video-gameplay-analyst'
import { OpenRouterVideoGameplayAnalyst } from '@/lib/playable/openrouter-video-gameplay-analyst'
import { createVideoGameplayAnalyst } from '@/lib/playable/video-analysis-backend'

describe('video analysis backend selection', () => {
  it('defaults to the gateway, which is the intended backend', () => {
    expect(createVideoGameplayAnalyst({ GEMINI_API_KEY: 'gemini', OPENROUTER_API_KEY: 'or' })).toBeInstanceOf(
      GeminiVideoGameplayAnalyst,
    )
  })

  it('uses OpenRouter only when asked for by name', () => {
    expect(
      createVideoGameplayAnalyst({ VIDEO_ANALYSIS_BACKEND: 'openrouter', OPENROUTER_API_KEY: 'or' }),
    ).toBeInstanceOf(OpenRouterVideoGameplayAnalyst)
  })

  // Falling through to the other backend would change where the video goes
  // and what the blueprint looks like with nothing to show for it.
  it('leaves analysis unavailable when the chosen backend has no key', () => {
    expect(createVideoGameplayAnalyst({ OPENROUTER_API_KEY: 'or' })).toBeUndefined()
    expect(
      createVideoGameplayAnalyst({ VIDEO_ANALYSIS_BACKEND: 'openrouter', GEMINI_API_KEY: 'gemini' }),
    ).toBeUndefined()
  })

  it('leaves analysis unavailable for an unrecognised backend name', () => {
    expect(
      createVideoGameplayAnalyst({
        VIDEO_ANALYSIS_BACKEND: 'open-router',
        GEMINI_API_KEY: 'gemini',
        OPENROUTER_API_KEY: 'or',
      }),
    ).toBeUndefined()
  })
})
