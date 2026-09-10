import type { PlayableAIConfig } from './ai-provider'

export async function probePlayableAIGateway(config: PlayableAIConfig, request: typeof fetch = fetch): Promise<void> {
  const authorization = { Authorization: `Bearer ${config.apiKey}` }
  const modelsResponse = await request(`${config.baseURL}/models`, { headers: authorization })
  if (!modelsResponse.ok) throw new Error('Playable AI gateway model check failed')

  const models = (await modelsResponse.json()) as { data?: Array<{ id?: unknown }> }
  if (
    !models.data?.some((model) => model.id === config.model) ||
    !models.data?.some((model) => model.id === config.videoModel)
  ) {
    throw new Error('Playable AI gateway model check failed')
  }

  const responsesResponse = await request(`${config.baseURL}/responses`, {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      input: 'Reply with OK.',
      max_output_tokens: 16,
      store: false,
    }),
  })
  if (!responsesResponse.ok) throw new Error('Playable AI gateway Responses check failed')

  const geminiResponse = await request(
    `${config.geminiBaseURL}/models/${encodeURIComponent(config.videoModel)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with OK.' }] }] }),
    },
  )
  if (!geminiResponse.ok) throw new Error('Playable AI gateway Gemini check failed')
}
