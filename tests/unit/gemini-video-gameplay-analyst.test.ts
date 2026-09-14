import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameplayBlueprint } from '@/lib/playable/schemas'

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }))

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>()
  return {
    ...actual,
    GoogleGenAI: vi.fn(function () {
      return { models: { generateContent } }
    }),
  }
})

const { GeminiVideoGameplayAnalyst } = await import('@/lib/playable/video-gameplay-analyst')

const blueprint: GameplayBlueprint = {
  version: 2,
  summary: '点击两个相同目标并消除。',
  orientation: 'portrait',
  controls: [{ value: '点击', confidence: 0.9, evidence: [] }],
  sceneStructure: { value: '网格', confidence: 0.9, evidence: [] },
  entities: [],
  coreLoop: { value: '配对并消除', confidence: 0.9, evidence: [] },
  stateTransitions: [{ value: '目标消失', confidence: 0.9, evidence: [] }],
  objective: { value: '清空目标', confidence: 0.8, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  audio: [],
  intentDivergence: [],
  visualStyle: '卡通',
  uncertainties: [],
  overallConfidence: 0.88,
}

const DURATION_SECONDS = 12

/** The channel that honours `generationConfig`: schema-shaped JSON, HIGH token count, `trafficType` present. */
function honouring() {
  return {
    text: JSON.stringify(blueprint),
    usageMetadata: {
      trafficType: 'ON_DEMAND',
      promptTokensDetails: [{ modality: 'VIDEO', tokenCount: DURATION_SECONDS * 264 }],
    },
  }
}

/** The channel that drops it: fenced JSON, default token count, no `trafficType`. */
function dropping() {
  return {
    text: '```json\n' + JSON.stringify(blueprint) + '\n```',
    usageMetadata: { promptTokensDetails: [{ modality: 'VIDEO', tokenCount: DURATION_SECONDS * 66 }] },
  }
}

function analyze(abortSignal?: AbortSignal) {
  return new GeminiVideoGameplayAnalyst().analyze({
    prompt: '',
    video: { bytes: new Uint8Array([1]), mimeType: 'video/mp4', durationSeconds: DURATION_SECONDS },
    abortSignal,
  })
}

describe('Gemini video gameplay analyst', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key')
    generateContent.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps retrying past the dropping channel until the honouring one answers', async () => {
    generateContent.mockResolvedValueOnce(dropping()).mockResolvedValueOnce(honouring())

    await expect(analyze()).resolves.toEqual({ blueprint, mediaResolution: 'high' })
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  // Failing here would leave the user with nothing because of a coin toss on
  // the gateway; the recorded resolution is what keeps the degradation honest.
  it('accepts a dropping-channel result once the attempts run out', async () => {
    generateContent.mockResolvedValue(dropping())

    await expect(analyze()).resolves.toEqual({ blueprint, mediaResolution: 'default' })
    expect(generateContent).toHaveBeenCalledTimes(4)
  })

  it('does not trust `trafficType` alone when the token count disagrees', async () => {
    generateContent.mockResolvedValue({
      ...honouring(),
      usageMetadata: {
        trafficType: 'ON_DEMAND',
        promptTokensDetails: [{ modality: 'VIDEO', tokenCount: DURATION_SECONDS * 66 }],
      },
    })

    await expect(analyze()).resolves.toMatchObject({ mediaResolution: 'default' })
  })

  // The route aborts just inside its time budget. Having already paid for a
  // usable low-resolution answer, throwing it away at the deadline would turn
  // a degraded result into a failure for no reason.
  it('returns the degraded result it already has when the deadline cuts a retry short', async () => {
    const controller = new AbortController()
    generateContent.mockResolvedValueOnce(dropping()).mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('aborted')
    })

    await expect(analyze(controller.signal)).resolves.toEqual({ blueprint, mediaResolution: 'default' })
  })

  it('fails when the deadline arrives before any usable answer', async () => {
    const controller = new AbortController()
    generateContent.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('aborted')
    })

    await expect(analyze(controller.signal)).rejects.toThrow()
  })
})
