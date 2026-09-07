import { PLAYABLE_OPENAI_MODEL } from './byok-session'

export const OPENAI_KEY_CHECK_TIMEOUT_MS = 10_000

export type KeyCheckResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'model_access' | 'quota' | 'rate_limited' | 'network' }

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
  return { ok: false, reason: 'network' }
}

export async function checkOpenAIKey(apiKey: string): Promise<KeyCheckResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_KEY_CHECK_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: PLAYABLE_OPENAI_MODEL,
        input: 'Reply OK',
        max_output_tokens: 2,
      }),
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
