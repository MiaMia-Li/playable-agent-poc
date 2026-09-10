import { describe, expect, it, vi } from 'vitest'
import {
  OPENROUTER_BASE_URL,
  createPlayableAIProvider,
  readPlayableAgentModel,
  readSharedPlayableAIKey,
} from '@/lib/playable/shared-ai-key'

const providerMocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(() => ({ provider: 'openrouter' })),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: providerMocks.createOpenAI,
}))

describe('shared playable AI key', () => {
  it('reads and trims the server-only OpenRouter environment variable', async () => {
    await expect(readSharedPlayableAIKey({ OPENROUTER_API_KEY: '  sk-or-shared  ' })).resolves.toBe('sk-or-shared')
  })

  it('returns undefined when the shared key is unavailable', async () => {
    await expect(readSharedPlayableAIKey({})).resolves.toBeUndefined()
  })

  it('uses the OpenRouter Responses base URL and qualified default model', () => {
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1')
    expect(readPlayableAgentModel({})).toBe('openai/gpt-5.6-sol')
    expect(readPlayableAgentModel({ PLAYABLE_AGENT_MODEL: '  openai/gpt-5.6-terra  ' })).toBe('openai/gpt-5.6-terra')
  })

  it('creates an OpenAI-compatible provider pointed at OpenRouter', () => {
    expect(createPlayableAIProvider('sk-or-test')).toEqual({ provider: 'openrouter' })
    expect(providerMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-or-test',
      baseURL: OPENROUTER_BASE_URL,
    })
  })
})
