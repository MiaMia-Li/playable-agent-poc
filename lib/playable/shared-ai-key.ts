import { createOpenAI } from '@ai-sdk/openai'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_PLAYABLE_AGENT_MODEL = 'openai/gpt-5.6-sol'
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/'
const DEFAULT_GEMINI_VIDEO_ANALYSIS_MODEL = 'gemini-3.5-flash'

export function createPlayableAIProvider(apiKey: string) {
  return createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL })
}

export async function readSharedPlayableAIKey(
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  return environment.OPENROUTER_API_KEY?.trim() || undefined
}

export function readPlayableAgentModel(environment: Record<string, string | undefined> = process.env): string {
  return environment.PLAYABLE_AGENT_MODEL?.trim() || DEFAULT_PLAYABLE_AGENT_MODEL
}

/**
 * Video analysis runs on Gemini through the company gateway, on a different
 * key from the shared OpenRouter one. Read explicitly rather than letting
 * `@google/genai` pick `GOOGLE_GEMINI_BASE_URL` up on its own: an implicit read
 * cannot be grepped and changes with the SDK version.
 */
export function readGeminiApiKey(environment: Record<string, string | undefined> = process.env): string | undefined {
  return environment.GEMINI_API_KEY?.trim() || undefined
}

/** Not a credential, but internal infrastructure, so it is redacted like one. */
export function readGeminiBaseUrl(environment: Record<string, string | undefined> = process.env): string {
  return environment.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL
}

export function readGeminiVideoAnalysisModel(environment: Record<string, string | undefined> = process.env): string {
  return environment.GEMINI_VIDEO_ANALYSIS_MODEL?.trim() || DEFAULT_GEMINI_VIDEO_ANALYSIS_MODEL
}
