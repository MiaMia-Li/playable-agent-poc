import { GeminiVideoGameplayAnalyst } from './gemini-video-gameplay-analyst'
import { OpenRouterVideoGameplayAnalyst } from './openrouter-video-gameplay-analyst'
import { readGeminiApiKey, readOpenRouterApiKey, readVideoAnalysisBackend } from './shared-ai-key'
import type { VideoGameplayAnalyst } from './video-gameplay-analyst'

/**
 * The one place that decides which service watches reference videos.
 * Returning `undefined` means "analysis unavailable" to every handler, so a
 * missing key or an unrecognised backend name fails the same visible way
 * (spec section 8) instead of quietly falling through to another backend.
 */
export function createVideoGameplayAnalyst(
  environment: Record<string, string | undefined> = process.env,
): VideoGameplayAnalyst | undefined {
  switch (readVideoAnalysisBackend(environment)) {
    case 'gemini':
      return readGeminiApiKey(environment) ? new GeminiVideoGameplayAnalyst() : undefined
    case 'openrouter':
      return readOpenRouterApiKey(environment) ? new OpenRouterVideoGameplayAnalyst() : undefined
    default:
      return undefined
  }
}
