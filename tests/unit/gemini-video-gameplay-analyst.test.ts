import { describe, expect, it, vi } from 'vitest'
import type { GameplayBlueprint } from '@/lib/playable/schemas'
import {
  GeminiVideoAnalysisError,
  GeminiVideoGameplayAnalyst,
  MAX_GEMINI_INLINE_VIDEO_BYTES,
} from '@/lib/playable/video-gameplay-analyst'

const blueprint: GameplayBlueprint = {
  version: 1,
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
  visualStyle: '卡通',
  uncertainties: [],
  overallConfidence: 0.88,
}

describe('Gemini video gameplay analyst', () => {
  it('sends the original private video inline to the native Gemini endpoint and returns a blueprint', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(blueprint) }] } }] }))
    const analyst = new GeminiVideoGameplayAnalyst({
      fetch: request,
      environment: {
        PLAYABLE_AI_BASE_URL: 'https://ai.pocketcity.com/v1',
        PLAYABLE_VIDEO_MODEL: 'gemini-3.5-flash',
      },
    })

    await expect(
      analyst.analyze({
        taskId: 'task-1',
        apiKey: 'shared-test-key',
        prompt: '分析玩法',
        video: { mimeType: 'video/mp4', bytes: new Uint8Array([1, 2, 3]) },
      }),
    ).resolves.toEqual(blueprint)

    expect(request).toHaveBeenCalledWith(
      'https://ai.pocketcity.com/v1beta/models/gemini-3.5-flash:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': 'shared-test-key',
        },
      }),
    )
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>
      generationConfig: Record<string, unknown>
    }
    expect(payload.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'video/mp4', data: 'AQID' },
      videoMetadata: { fps: 2 },
    })
    expect(payload.contents[0].parts[1]).toEqual(expect.objectContaining({ text: expect.stringContaining('分析玩法') }))
    expect(payload.generationConfig).toEqual(
      expect.objectContaining({ responseMimeType: 'application/json', responseJsonSchema: expect.any(Object) }),
    )
  })

  it('rejects videos that cannot safely fit in an inline request before contacting the gateway', async () => {
    const request = vi.fn<typeof fetch>()
    const analyst = new GeminiVideoGameplayAnalyst({ fetch: request })

    await expect(
      analyst.analyze({
        taskId: 'task-1',
        apiKey: 'shared-test-key',
        prompt: '分析玩法',
        video: {
          mimeType: 'video/mp4',
          bytes: new Uint8Array(MAX_GEMINI_INLINE_VIDEO_BYTES + 1),
        },
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<GeminiVideoAnalysisError>>({ code: 'video_too_large' }))
    expect(request).not.toHaveBeenCalled()
  })
})
