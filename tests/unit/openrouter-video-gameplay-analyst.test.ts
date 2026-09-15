import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameplayBlueprint } from '@/lib/playable/schemas'
import {
  OPENROUTER_MAX_VIDEO_BYTES,
  OpenRouterVideoGameplayAnalyst,
} from '@/lib/playable/openrouter-video-gameplay-analyst'

const blueprint: GameplayBlueprint = {
  version: 4,
  timeline: [],
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
  visualSpec: {
    artStyle: '卡通',
    palette: [],
    background: '',
    layout: [],
    uiComponents: [],
    entityLooks: [],
    effects: [],
  },
  keyframes: [],
  uncertainties: [],
  overallConfidence: 0.88,
}

const DURATION_SECONDS = 12

function completion(content: string, videoTokens?: number) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens_details: { video_tokens: videoTokens, audio_tokens: DURATION_SECONDS * 25 } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call][1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown> & {
    messages: { role: string; content: unknown }[]
  }
}

describe('OpenRouter video gameplay analyst', () => {
  const fetchMock = vi.fn()

  function analyze(bytes = new Uint8Array([1, 2, 3])) {
    return new OpenRouterVideoGameplayAnalyst({ fetch: fetchMock as typeof fetch }).analyze({
      prompt: '',
      video: { bytes, mimeType: 'video/mp4', durationSeconds: DURATION_SECONDS },
    })
  }

  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-key')
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends the video inline with a top-level HIGH resolution and an enforced schema', async () => {
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify(blueprint), DURATION_SECONDS * 264))

    await expect(analyze()).resolves.toEqual({ blueprint, mediaResolution: 'high' })
    const body = sentBody(fetchMock)
    expect(body.media_resolution).toBe('MEDIA_RESOLUTION_HIGH')
    expect(body.provider).toEqual({ require_parameters: true })
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    const userContent = body.messages[1].content as { type: string; video_url?: Record<string, unknown> }[]
    expect(userContent[0]).toEqual({ type: 'video_url', video_url: { url: 'data:video/mp4;base64,AQID' } })
  })

  // Seen as a 400 from Gemini when the full blueprint schema kept its bounds.
  it('strips the bound keywords Gemini rejects from the response schema', async () => {
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify(blueprint), DURATION_SECONDS * 264))

    await analyze()
    const schema = JSON.stringify((sentBody(fetchMock).response_format as { json_schema: unknown }).json_schema)
    expect(schema).not.toMatch(/"(minLength|maxLength|minimum|maximum|minItems|maxItems)"/)
  })

  it('reports the resolution the token count shows, not the one it asked for', async () => {
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify(blueprint), DURATION_SECONDS * 66))

    await expect(analyze()).resolves.toMatchObject({ mediaResolution: 'default' })
  })

  it('treats an unusable reply as a spent attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(completion('看起来是消除类。'))
      .mockResolvedValueOnce(completion(JSON.stringify(blueprint), DURATION_SECONDS * 264))

    await expect(analyze()).resolves.toMatchObject({ mediaResolution: 'high' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails on an error response without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"code":502}}', { status: 502 }))

    await expect(analyze()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  // Past this size the request either exceeds OpenRouter's body limit or gets
  // a 502 from upstream, after a minute of uploading.
  it('refuses a video too large to send, before sending anything', async () => {
    await expect(analyze(new Uint8Array(OPENROUTER_MAX_VIDEO_BYTES + 1))).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails without a key instead of sending an unauthenticated request', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')

    await expect(analyze()).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OpenRouter intent comparison', () => {
  const fetchMock = vi.fn()
  const divergence = [
    {
      value: '视频是连连看，不是三消',
      confidence: 0.9,
      evidence: [{ startSeconds: 2, endSeconds: 4, observation: '连线' }],
    },
  ]

  function compare() {
    return new OpenRouterVideoGameplayAnalyst({ fetch: fetchMock as typeof fetch }).compareIntent({
      blueprint,
      intent: '玩法概念：三消',
      durationSeconds: DURATION_SECONDS,
    })
  }

  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-key')
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends text only and returns just the divergence', async () => {
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify({ intentDivergence: divergence })))

    await expect(compare()).resolves.toEqual(divergence)
    const body = sentBody(fetchMock)
    expect(JSON.stringify(body.messages)).not.toContain('video_url')
    expect(body).not.toHaveProperty('media_resolution')
  })

  it('refuses divergence evidence outside the video', async () => {
    const invented = [
      { value: '结尾有奖励关', confidence: 0.5, evidence: [{ startSeconds: 40, endSeconds: 45, observation: '奖励' }] },
    ]
    fetchMock.mockImplementation(async () => completion(JSON.stringify({ intentDivergence: invented })))

    await expect(compare()).rejects.toThrow()
  })
})
