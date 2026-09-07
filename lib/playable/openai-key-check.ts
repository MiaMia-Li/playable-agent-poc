import { PLAYABLE_OPENAI_MODEL } from './byok-session'

export type KeyCheckResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'model_access' | 'quota' | 'rate_limited' | 'network' }

interface OpenAIErrorBody {
  error?: {
    code?: string
    type?: string
  }
}

export async function checkOpenAIKey(apiKey: string): Promise<KeyCheckResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PLAYABLE_OPENAI_MODEL,
        input: 'Reply OK',
        max_output_tokens: 2,
      }),
    })

    if (response.ok) return { ok: true }
    if (response.status === 401) return { ok: false, reason: 'invalid' }
    if (response.status === 403 || response.status === 404) return { ok: false, reason: 'model_access' }
    if (response.status === 429) {
      const body = (await response.json().catch(() => undefined)) as OpenAIErrorBody | undefined
      const code = body?.error?.code ?? body?.error?.type
      return { ok: false, reason: code === 'insufficient_quota' ? 'quota' : 'rate_limited' }
    }
    return { ok: false, reason: 'network' }
  } catch {
    return { ok: false, reason: 'network' }
  }
}
