import { PLAYABLE_OPENAI_MODEL } from './byok-session'
import { createExternalErrorLoggingFetch } from './external-request-logging'

export const OPENAI_KEY_CHECK_TIMEOUT_MS = 10_000

export type KeyCheckResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'invalid'
        | 'model_access'
        | 'quota'
        | 'rate_limited'
        | 'invalid_request'
        | 'provider_unavailable'
        | 'network'
    }

interface OpenAIErrorBody {
  error?: {
    code?: string
    type?: string
  }
}

function classifyProviderFailure(status: number, code?: string): KeyCheckResult {
  if (code === 'invalid_api_key') return { ok: false, reason: 'invalid' }
  if (code === 'model_not_found' || code === 'model_access_denied' || code === 'permission_denied') {
    return { ok: false, reason: 'model_access' }
  }
  if (code === 'insufficient_quota') return { ok: false, reason: 'quota' }
  if (code === 'rate_limit_exceeded') return { ok: false, reason: 'rate_limited' }

  if (status === 401) return { ok: false, reason: 'invalid' }
  if (status === 403 || status === 404) return { ok: false, reason: 'model_access' }
  if (status === 429) return { ok: false, reason: 'rate_limited' }
  if (status === 400 || status === 409 || status === 422) return { ok: false, reason: 'invalid_request' }
  return { ok: false, reason: 'provider_unavailable' }
}

export async function checkOpenAIKey(apiKey: string): Promise<KeyCheckResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_KEY_CHECK_TIMEOUT_MS)
  const request = createExternalErrorLoggingFetch('OpenAI', [apiKey])

  try {
    const response = await request(`https://api.openai.com/v1/models/${encodeURIComponent(PLAYABLE_OPENAI_MODEL)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })

    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => undefined)) as OpenAIErrorBody | undefined
    return classifyProviderFailure(response.status, body?.error?.code ?? body?.error?.type)
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(timeout)
  }
}
