import { createOpenAI } from '@ai-sdk/openai'

const DEFAULT_PLAYABLE_AI_BASE_URL = 'https://ai.pocketcity.com/v1'
const DEFAULT_PLAYABLE_AGENT_MODEL = 'gpt-5.6-sol'
const DEFAULT_PLAYABLE_SANDBOX_CODEX_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_PLAYABLE_SANDBOX_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_PLAYABLE_IMAGE_MODEL = 'gpt-image-2'
const DEFAULT_PLAYABLE_SPEECH_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_PLAYABLE_VIDEO_MODEL = 'gemini-3.5-flash'

type PlayableAIConfigurationErrorCode = 'api_key_missing' | 'base_url_invalid'

export interface PlayableAIEndpointConfig {
  baseURL: string
  model: string
  imageModel: string
  speechModel: string
  geminiBaseURL: string
  videoModel: string
}

export interface PlayableAIConfig extends PlayableAIEndpointConfig {
  apiKey: string
}

export interface PlayableSandboxCodexEndpointConfig {
  baseURL: string
  model: string
}

export interface PlayableSandboxCodexConfig extends PlayableSandboxCodexEndpointConfig {
  apiKey: string
}

export class PlayableAIConfigurationError extends Error {
  readonly code: PlayableAIConfigurationErrorCode

  constructor(code: PlayableAIConfigurationErrorCode) {
    super(code)
    this.name = 'PlayableAIConfigurationError'
    this.code = code
  }
}

function normalizeBaseURL(value: string | undefined, fallback = DEFAULT_PLAYABLE_AI_BASE_URL): string {
  const raw = value?.trim() || fallback
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new PlayableAIConfigurationError('base_url_invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PlayableAIConfigurationError('base_url_invalid')
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`
  return parsed.toString().replace(/\/+$/, '')
}

function normalizeGeminiBaseURL(value: string | undefined, openAIBaseURL: string): string {
  const raw = value?.trim() || openAIBaseURL.replace(/\/v1$/, '')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new PlayableAIConfigurationError('base_url_invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PlayableAIConfigurationError('base_url_invalid')
  }
  const pathname = parsed.pathname.replace(/\/(?:v1|v1beta)\/?$/, '').replace(/\/+$/, '')
  parsed.pathname = `${pathname}/v1beta`
  return parsed.toString().replace(/\/+$/, '')
}

export function readPlayableAIConfig(environment: Record<string, string | undefined> = process.env): PlayableAIConfig {
  const apiKey = environment.PLAYABLE_AI_API_KEY?.trim()
  if (!apiKey) throw new PlayableAIConfigurationError('api_key_missing')

  return {
    apiKey,
    ...readPlayableAIEndpointConfig(environment),
  }
}

export function readPlayableAIEndpointConfig(
  environment: Record<string, string | undefined> = process.env,
): PlayableAIEndpointConfig {
  const baseURL = normalizeBaseURL(environment.PLAYABLE_AI_BASE_URL)
  return {
    baseURL,
    model: environment.PLAYABLE_AGENT_MODEL?.trim() || DEFAULT_PLAYABLE_AGENT_MODEL,
    imageModel: environment.PLAYABLE_IMAGE_MODEL?.trim() || DEFAULT_PLAYABLE_IMAGE_MODEL,
    speechModel: environment.PLAYABLE_SPEECH_MODEL?.trim() || DEFAULT_PLAYABLE_SPEECH_MODEL,
    geminiBaseURL: normalizeGeminiBaseURL(environment.PLAYABLE_GEMINI_BASE_URL, baseURL),
    videoModel: environment.PLAYABLE_VIDEO_MODEL?.trim() || DEFAULT_PLAYABLE_VIDEO_MODEL,
  }
}

export function readPlayableSandboxCodexEndpointConfig(
  environment: Record<string, string | undefined> = process.env,
): PlayableSandboxCodexEndpointConfig {
  return {
    baseURL: normalizeBaseURL(environment.PLAYABLE_SANDBOX_CODEX_BASE_URL, DEFAULT_PLAYABLE_SANDBOX_CODEX_BASE_URL),
    model: environment.PLAYABLE_SANDBOX_CODEX_MODEL?.trim() || DEFAULT_PLAYABLE_SANDBOX_CODEX_MODEL,
  }
}

export function readPlayableSandboxCodexConfig(
  environment: Record<string, string | undefined> = process.env,
): PlayableSandboxCodexConfig {
  const apiKey = environment.PLAYABLE_SANDBOX_CODEX_API_KEY?.trim()
  if (!apiKey) throw new PlayableAIConfigurationError('api_key_missing')
  return {
    apiKey,
    ...readPlayableSandboxCodexEndpointConfig(environment),
  }
}

export async function readSharedPlayableAIKey(): Promise<string | undefined> {
  try {
    return readPlayableAIConfig().apiKey
  } catch (error) {
    if (error instanceof PlayableAIConfigurationError) return undefined
    throw error
  }
}

export async function readPlayableSandboxCodexKey(): Promise<string | undefined> {
  try {
    return readPlayableSandboxCodexConfig().apiKey
  } catch (error) {
    if (error instanceof PlayableAIConfigurationError) return undefined
    throw error
  }
}

export function createPlayableOpenAI(
  apiKey: string,
  environment: Record<string, string | undefined> = process.env,
): ReturnType<typeof createOpenAI> {
  return createOpenAI({
    apiKey,
    baseURL: readPlayableAIEndpointConfig(environment).baseURL,
  })
}

export {
  DEFAULT_PLAYABLE_AGENT_MODEL,
  DEFAULT_PLAYABLE_AI_BASE_URL,
  DEFAULT_PLAYABLE_IMAGE_MODEL,
  DEFAULT_PLAYABLE_SPEECH_MODEL,
  DEFAULT_PLAYABLE_SANDBOX_CODEX_BASE_URL,
  DEFAULT_PLAYABLE_SANDBOX_CODEX_MODEL,
  DEFAULT_PLAYABLE_VIDEO_MODEL,
}
