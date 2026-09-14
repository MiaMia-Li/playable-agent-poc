import { GoogleGenAI, MediaResolution, type GenerateContentResponse } from '@google/genai'
import type { GameplayBlueprint, GameplayInference } from './schemas'
import { logExternalRequestError } from './external-request-logging'
import { readGeminiApiKey, readGeminiBaseUrl, readGeminiVideoAnalysisModel } from './shared-ai-key'
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
 * Roughly two thirds of gateway requests land on a channel that discards
 * `generationConfig`, taking `mediaResolution` and `responseJsonSchema` with
 * it. Retrying is worth it because the honouring channel gives both higher
 * resolution and an enforced schema, and neither has a substitute. Four
 * attempts leaves around a one in six chance of never seeing it, which is why
 * exhausting the budget degrades rather than fails.
 */
const HONOURING_CHANNEL_ATTEMPTS = 4

/**
 * Two independent signals, combined. `trafficType` correlated perfectly with
 * the applied configuration in every observed request, but it is a side effect
 * rather than a documented contract, so the token count is checked too: if the
 * gateway ever changes what `trafficType` means, this reports `default` rather
 * than silently claiming an accuracy it did not get.
 */
function appliedResolution(response: GenerateContentResponse, durationSeconds: number | undefined) {
  const usage = response.usageMetadata as
    | { trafficType?: string; promptTokensDetails?: { modality?: string; tokenCount?: number }[] }
    | undefined
  if (!usage?.trafficType) return 'default' as const
  const videoTokens = usage.promptTokensDetails?.find(
    (detail) => detail.modality?.toUpperCase() === 'VIDEO',
  )?.tokenCount
  return resolutionFromVideoTokens(videoTokens, durationSeconds)
}

/** Gemini through the company gateway: the intended backend, see spec section 6.1. */
export class GeminiVideoGameplayAnalyst implements VideoGameplayAnalyst {
  readonly model = readGeminiVideoAnalysisModel()

  async analyze(input: {
    prompt: string
    video: AnalyzedVideo
    abortSignal?: AbortSignal
  }): Promise<VideoGameplayAnalysisResult> {
    const apiKey = readGeminiApiKey()
    if (!apiKey) throw new Error('Gemini API key is not configured')
    const baseUrl = readGeminiBaseUrl()
    const model = this.model

    const client = new GoogleGenAI({ apiKey, httpOptions: { baseUrl } })
    const responseJsonSchema = blueprintResponseSchema()
    const contents = [
      {
        role: 'user',
        parts: [
          // No `videoMetadata`. The gateway drops it at random, and a sampling
          // rate that applies one time in five would make the same video yield
          // different results with nothing to show which run got what.
          { inlineData: { data: Buffer.from(input.video.bytes).toString('base64'), mimeType: input.video.mimeType } },
          { text: analysisPrompt(input) },
        ],
      },
    ]

    let degraded: VideoGameplayAnalysisResult | undefined
    for (let attempt = 0; attempt < HONOURING_CHANNEL_ATTEMPTS; attempt += 1) {
      // Running out of time while chasing the honouring channel is the same
      // situation as running out of attempts: a usable low-resolution result
      // in hand beats none.
      if (input.abortSignal?.aborted && degraded) return degraded
      input.abortSignal?.throwIfAborted()
      let response: GenerateContentResponse
      try {
        response = await client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: QDAI_INSTRUCTIONS,
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
            responseMimeType: 'application/json',
            responseJsonSchema,
            abortSignal: input.abortSignal,
          },
        })
      } catch (error) {
        if (input.abortSignal?.aborted && degraded) return degraded
        logExternalRequestError('Gemini', error, [apiKey, baseUrl])
        throw error
      }

      const mediaResolution = appliedResolution(response, input.video.durationSeconds)
      let blueprint: GameplayBlueprint
      try {
        blueprint = validateEvidenceTimes(parseBlueprint(response.text ?? ''), input.video.durationSeconds)
      } catch {
        // Almost always the unconstrained channel answering off-shape. Treat it
        // as a spent attempt so the loop can try for the honouring one.
        console.error('Gemini video analysis returned an unusable blueprint')
        continue
      }

      if (mediaResolution === 'high') return { blueprint, mediaResolution }
      // Keep the first usable low-resolution result. If the budget runs out
      // this is returned rather than failing: it is still a real observation of
      // the video, and the caller records the resolution so the user can re-run.
      degraded ??= { blueprint, mediaResolution }
    }

    if (degraded) return degraded
    throw new Error('Gemini video analysis produced no usable blueprint')
  }

  async compareIntent(input: {
    blueprint: GameplayBlueprint
    intent: string
    durationSeconds?: number
    abortSignal?: AbortSignal
  }): Promise<GameplayInference[]> {
    const apiKey = readGeminiApiKey()
    if (!apiKey) throw new Error('Gemini API key is not configured')
    const baseUrl = readGeminiBaseUrl()
    const client = new GoogleGenAI({ apiKey, httpOptions: { baseUrl } })
    const text = intentComparisonPrompt(input)

    // No resolution to chase here, only the schema. The dropping channel still
    // answers usefully most of the time, so an unusable reply is just a spent
    // attempt, as in `analyze`.
    for (let attempt = 0; attempt < HONOURING_CHANNEL_ATTEMPTS; attempt += 1) {
      input.abortSignal?.throwIfAborted()
      let response: GenerateContentResponse
      try {
        response = await client.models.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text }] }],
          config: {
            systemInstruction: INTENT_INSTRUCTIONS,
            responseMimeType: 'application/json',
            responseJsonSchema: intentResponseSchema(),
            abortSignal: input.abortSignal,
          },
        })
      } catch (error) {
        logExternalRequestError('Gemini', error, [apiKey, baseUrl])
        throw error
      }
      try {
        const intentDivergence = parseIntentDivergence(response.text ?? '')
        validateEvidenceTimes({ ...input.blueprint, intentDivergence }, input.durationSeconds)
        return intentDivergence
      } catch {
        console.error('Gemini intent comparison returned an unusable result')
      }
    }
    throw new Error('Gemini intent comparison produced no usable result')
  }
}
