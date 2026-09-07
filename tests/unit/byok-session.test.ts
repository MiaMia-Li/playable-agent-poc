import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENAI_KEY_COOKIE,
  OPENAI_KEY_TTL,
  clearOpenAIKeyCookie,
  decryptOpenAIKey,
  encryptOpenAIKey,
  readOpenAIKeyCookie,
  setOpenAIKeyCookie,
} from '@/lib/playable/byok-session'
import { checkOpenAIKey } from '@/lib/playable/openai-key-check'
import { redactSecrets } from '@/lib/playable/redact'

const secret = Buffer.alloc(32, 7).toString('base64url')
const apiKey = 'sk-test-secret'
const userId = 'user-123'

function cookieRequest(value?: string) {
  return {
    cookies: {
      get: (name: string) => (name === OPENAI_KEY_COOKIE && value ? { value } : undefined),
    },
  }
}

describe('OpenAI key session', () => {
  it('encrypts the key in a two-hour, user-bound JWE', async () => {
    const token = await encryptOpenAIKey(userId, apiKey, secret)

    expect(OPENAI_KEY_TTL).toBe('2h')
    expect(token).not.toContain(apiKey)
    expect(await decryptOpenAIKey(token, secret)).toEqual({
      userId,
      apiKey,
      model: 'gpt-5.6-sol',
    })
  })

  it('reads the key only for the authenticated user', async () => {
    const token = await encryptOpenAIKey(userId, apiKey, secret)

    await expect(readOpenAIKeyCookie(cookieRequest(token), userId, secret)).resolves.toBe(apiKey)
    await expect(readOpenAIKeyCookie(cookieRequest(token), 'another-user', secret)).resolves.toBeUndefined()
  })

  it('rejects expired credentials', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T00:00:00Z'))
    const token = await encryptOpenAIKey(userId, apiKey, secret)

    vi.setSystemTime(new Date('2026-09-07T02:00:01Z'))
    await expect(readOpenAIKeyCookie(cookieRequest(token), userId, secret)).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('sets the exact hardened cookie contract without exposing plaintext', async () => {
    const response = Response.json({ ok: true })
    const token = await setOpenAIKeyCookie(response, userId, apiKey, secret)
    const setCookie = response.headers.get('set-cookie')

    expect(token).not.toContain(apiKey)
    expect(setCookie).toContain(`${OPENAI_KEY_COOKIE}=${token}`)
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=7200')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toContain(apiKey)
  })

  it('clears the session cookie with matching security attributes', () => {
    const response = Response.json({ ok: true })

    clearOpenAIKeyCookie(response)

    expect(response.headers.get('set-cookie')).toContain(
      `${OPENAI_KEY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
    )
  })
})

describe('secret redaction', () => {
  it('redacts complete secrets', () => {
    expect(redactSecrets(`Bearer ${apiKey}`, [apiKey])).toBe('Bearer [REDACTED]')
  })

  it('redacts partial OpenAI keys', () => {
    expect(redactSecrets('Provider rejected sk-test-secr...', [apiKey])).toBe('Provider rejected [REDACTED]')
  })
})

describe('OpenAI model access check', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes only the required minimal gpt-5.6-sol Responses request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(checkOpenAIKey(apiKey)).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        input: 'Reply OK',
        max_output_tokens: 2,
      }),
    })
  })

  it.each([
    [401, { error: { code: 'invalid_api_key' } }, 'invalid'],
    [403, { error: { code: 'model_not_found' } }, 'model_access'],
    [404, { error: { code: 'model_not_found' } }, 'model_access'],
    [429, { error: { code: 'insufficient_quota' } }, 'quota'],
    [429, { error: { code: 'rate_limit_exceeded' } }, 'rate_limited'],
  ] as const)('maps provider status %s to a safe reason', async (status, body, reason) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })))

    const result = await checkOpenAIKey(apiKey)

    expect(result).toEqual({ ok: false, reason })
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(body))
  })

  it('returns a safe network reason without leaking thrown errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`request failed for ${apiKey}`)))

    const result = await checkOpenAIKey(apiKey)

    expect(result).toEqual({ ok: false, reason: 'network' })
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })
})
