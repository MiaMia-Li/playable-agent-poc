import type { GameplayBlueprint, GameplayInference } from './schemas'
import { createExternalErrorLoggingFetch } from './external-request-logging'
import { OPENROUTER_BASE_URL, readOpenRouterApiKey, readOpenRouterVideoAnalysisModel } from './shared-ai-key'
import {
  INTENT_INSTRUCTIONS,
  QDAI_INSTRUCTIONS,
  analysisPrompt,
  blueprintResponseSchema,
  intentComparisonPrompt,
  intentResponseSchema,
  parseBlueprint,
  parseIntentDivergence,
  resolutionFromVideoTokens,
  validateEvidenceTimes,
  type AnalyzedVideo,
  type VideoGameplayAnalysisResult,
  type VideoGameplayAnalyst,
} from './video-gameplay-analyst'

/**
 * OpenRouter refuses request bodies over 100,000,000 bytes for Google, and
 * Vertex answered 502 from about 57 MiB of raw video in practice while 52 MiB
 * passed. Refusing here costs nothing; sending it costs a minute and fails.
 */
export const OPENROUTER_MAX_VIDEO_BYTES = 52 * 1024 * 1024

/**
 * Unlike the gateway there is no channel lottery to chase: resolution and
 * schema were applied on every measured request. Retries only cover a reply
 * that still fails validation, such as evidence past the end of the video.
 */
const ATTEMPTS = 2

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[]
  usage?: { prompt_tokens_details?: { video_tokens?: number } }
}

/**
 * Gemini through OpenRouter. A stopgap for environments that cannot reach the
 * company gateway, selected with `VIDEO_ANALYSIS_BACKEND=openrouter`; the
 * gateway analyst stays the intended backend. Same prompt, schema and
 * validation, so switching back is a configuration change.
 *
 * Raw fetch rather than the AI SDK: its Responses provider has no video part,
 * and video only reaches Gemini through `/chat/completions` as `video_url`.
 */
export class OpenRouterVideoGameplayAnalyst implements VideoGameplayAnalyst {
  readonly model = readOpenRouterVideoAnalysisModel()
  private readonly request: typeof fetch

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.request = options.fetch ?? fetch
  }

  async analyze(input: {
    prompt: string
    video: AnalyzedVideo
    abortSignal?: AbortSignal
  }): Promise<VideoGameplayAnalysisResult> {
    const apiKey = readOpenRouterApiKey()
    if (!apiKey) throw new Error('OpenRouter API key is not configured')
    if (input.video.bytes.byteLength > OPENROUTER_MAX_VIDEO_BYTES) {
      throw new Error('Reference video is too large for OpenRouter video analysis')
    }
    const videoUrl = `data:${input.video.mimeType};base64,${Buffer.from(input.video.bytes).toString('base64')}`
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: QDAI_INSTRUCTIONS },
        {
          role: 'user',
          content: [
            // Per-part `fps` and `media_resolution` are accepted and silently
            // ignored, so neither is sent; sampling stays at one frame per second.
            { type: 'video_url', video_url: { url: videoUrl } },
            { type: 'text', text: analysisPrompt(input) },
          ],
        },
      ],
      // Top level and in Gemini's enum spelling: OpenRouter validates it and
      // forwards it. Lowercase `high` is rejected with a 400.
      media_resolution: 'MEDIA_RESOLUTION_HIGH',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'gameplay_blueprint', strict: true, schema: blueprintResponseSchema() },
      },
      // Otherwise a provider that ignores the schema or the resolution is a
      // legitimate routing target.
      provider: { require_parameters: true },
    }

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      input.abortSignal?.throwIfAborted()
      const completion = await this.complete(apiKey, body, input.abortSignal)
      try {
        const blueprint = validateEvidenceTimes(
          parseBlueprint(completion.choices?.[0]?.message?.content ?? ''),
          input.video.durationSeconds,
        )
        return {
          blueprint,
          mediaResolution: resolutionFromVideoTokens(
            completion.usage?.prompt_tokens_details?.video_tokens,
            input.video.durationSeconds,
          ),
        }
      } catch {
        console.error('OpenRouter video analysis returned an unusable blueprint')
      }
    }
    throw new Error('OpenRouter video analysis produced no usable blueprint')
  }

  async compareIntent(input: {
    blueprint: GameplayBlueprint
    intent: string
    durationSeconds?: number
    abortSignal?: AbortSignal
  }): Promise<GameplayInference[]> {
    const apiKey = readOpenRouterApiKey()
    if (!apiKey) throw new Error('OpenRouter API key is not configured')
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: INTENT_INSTRUCTIONS },
        { role: 'user', content: intentComparisonPrompt(input) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'intent_divergence', strict: true, schema: intentResponseSchema() },
      },
      provider: { require_parameters: true },
    }

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      input.abortSignal?.throwIfAborted()
      const completion = await this.complete(apiKey, body, input.abortSignal)
      try {
        const intentDivergence = parseIntentDivergence(completion.choices?.[0]?.message?.content ?? '')
        validateEvidenceTimes({ ...input.blueprint, intentDivergence }, input.durationSeconds)
        return intentDivergence
      } catch {
        console.error('OpenRouter intent comparison returned an unusable result')
      }
    }
    throw new Error('OpenRouter intent comparison produced no usable result')
  }

  private async complete(apiKey: string, body: unknown, abortSignal: AbortSignal | undefined) {
    const request = createExternalErrorLoggingFetch('OpenRouter', [apiKey], this.request)
    const response = await request(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortSignal,
    })
    if (!response.ok) throw new Error('OpenRouter video analysis request failed')
    return (await response.json()) as ChatCompletion
  }
}
