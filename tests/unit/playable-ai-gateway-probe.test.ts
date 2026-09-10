import { describe, expect, it, vi } from 'vitest'
import { probePlayableAIGateway } from '@/lib/playable/ai-gateway-probe'

describe('playable AI gateway probe', () => {
  it('checks the configured OpenAI-compatible and native Gemini endpoints', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'company-agent-model' }, { id: 'company-video-model' }] }))
      .mockResolvedValueOnce(Response.json({ id: 'response-test' }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }))

    await expect(
      probePlayableAIGateway(
        {
          apiKey: 'shared-test-key',
          baseURL: 'https://gateway.example/v1',
          model: 'company-agent-model',
          imageModel: 'company-image-model',
          speechModel: 'company-speech-model',
          geminiBaseURL: 'https://gateway.example/v1beta',
          videoModel: 'company-video-model',
        },
        request,
      ),
    ).resolves.toBeUndefined()

    expect(request).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer shared-test-key' } }),
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      'https://gateway.example/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer shared-test-key',
          'Content-Type': 'application/json',
        },
      }),
    )
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
      model: 'company-agent-model',
      input: 'Reply with OK.',
      max_output_tokens: 16,
      store: false,
    })
    expect(request).toHaveBeenNthCalledWith(
      3,
      'https://gateway.example/v1beta/models/company-video-model:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': 'shared-test-key',
        },
      }),
    )
  })

  it('fails without exposing a gateway response body when the configured model is unavailable', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }))

    await expect(
      probePlayableAIGateway(
        {
          apiKey: 'shared-test-key',
          baseURL: 'https://gateway.example/v1',
          model: 'missing-model',
          imageModel: 'company-image-model',
          speechModel: 'company-speech-model',
          geminiBaseURL: 'https://gateway.example/v1beta',
          videoModel: 'company-video-model',
        },
        request,
      ),
    ).rejects.toThrow('Playable AI gateway model check failed')
  })
})
