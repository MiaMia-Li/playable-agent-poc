import { createOpenAI } from '@ai-sdk/openai'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_PLAYABLE_AGENT_MODEL = 'openai/gpt-5.6-sol'

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
