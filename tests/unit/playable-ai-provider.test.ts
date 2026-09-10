import { describe, expect, it, vi } from 'vitest'

const { createOpenAI } = vi.hoisted(() => ({ createOpenAI: vi.fn(() => ({ provider: 'company-gateway' })) }))

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }))

import {
  createPlayableOpenAI,
  PlayableAIConfigurationError,
  readPlayableAIEndpointConfig,
  readPlayableAIConfig,
  readPlayableSandboxCodexConfig,
} from '@/lib/playable/ai-provider'

describe('shared playable AI provider', () => {
  it('uses the server shared key and normalizes the company gateway API root', () => {
    expect(
      readPlayableAIConfig({
        PLAYABLE_AI_API_KEY: 'shared-test-key',
        PLAYABLE_AI_BASE_URL: 'https://ai.pocketcity.com/',
        PLAYABLE_AGENT_MODEL: 'gpt-5.6-sol',
      }),
    ).toEqual({
      apiKey: 'shared-test-key',
      baseURL: 'https://ai.pocketcity.com/v1',
      model: 'gpt-5.6-sol',
      imageModel: 'gpt-image-2',
      speechModel: 'gpt-4o-mini-tts',
      geminiBaseURL: 'https://ai.pocketcity.com/v1beta',
      videoModel: 'gemini-3.5-flash',
    })
  })

  it('does not fall back to a personal or conventional OpenAI key', () => {
    expect(() =>
      readPlayableAIConfig({
        OPENAI_API_KEY: 'personal-test-key',
        PLAYABLE_AI_BASE_URL: 'https://ai.pocketcity.com/v1',
      }),
    ).toThrow(new PlayableAIConfigurationError('api_key_missing'))
  })

  it('keeps the public Sandbox Codex credential separate from the company gateway credential', () => {
    expect(
      readPlayableSandboxCodexConfig({
        PLAYABLE_AI_API_KEY: 'company-test-key',
        PLAYABLE_AI_BASE_URL: 'https://ai.pocketcity.com/v1',
        PLAYABLE_SANDBOX_CODEX_API_KEY: 'personal-test-key',
        PLAYABLE_SANDBOX_CODEX_BASE_URL: 'https://api.openai.com',
        PLAYABLE_SANDBOX_CODEX_MODEL: 'gpt-5.5',
      }),
    ).toEqual({
      apiKey: 'personal-test-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
    })

    expect(() =>
      readPlayableSandboxCodexConfig({
        PLAYABLE_AI_API_KEY: 'company-test-key',
      }),
    ).toThrow(new PlayableAIConfigurationError('api_key_missing'))
  })

  it('creates the OpenAI-compatible client against the configured gateway', () => {
    const provider = createPlayableOpenAI('shared-test-key', {
      PLAYABLE_AI_BASE_URL: 'https://ai.pocketcity.com',
    })

    expect(provider).toEqual({ provider: 'company-gateway' })
    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: 'shared-test-key',
      baseURL: 'https://ai.pocketcity.com/v1',
    })
  })

  it('provides endpoint and model configuration without reading a credential', () => {
    expect(
      readPlayableAIEndpointConfig({
        PLAYABLE_AI_BASE_URL: 'https://gateway.example/company/',
        PLAYABLE_AGENT_MODEL: 'company-agent-model',
        PLAYABLE_IMAGE_MODEL: 'company-image-model',
        PLAYABLE_SPEECH_MODEL: 'company-speech-model',
        PLAYABLE_VIDEO_MODEL: 'company-video-model',
      }),
    ).toEqual({
      baseURL: 'https://gateway.example/company/v1',
      model: 'company-agent-model',
      imageModel: 'company-image-model',
      speechModel: 'company-speech-model',
      geminiBaseURL: 'https://gateway.example/company/v1beta',
      videoModel: 'company-video-model',
    })
  })
})
