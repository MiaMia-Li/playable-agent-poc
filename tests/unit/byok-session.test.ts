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
import { OPENAI_KEY_CHECK_TIMEOUT_MS, checkOpenAIKey } from '@/lib/playable/openai-key-check'
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
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toContain(apiKey)
  })

  it('clears the session cookie with matching security attributes', () => {
    const response = Response.json({ ok: true })

    clearOpenAIKeyCookie(response)

    expect(response.headers.get('set-cookie')).toContain(
      `${OPENAI_KEY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    )
  })
})

describe('secret redaction', () => {
  it('redacts complete secrets', () => {
    expect(redactSecrets(`Bearer ${apiKey}`, [apiKey])).toBe('Bearer [REDACTED]')
  })

  it('redacts realistic complete and partial OpenAI keys at a non-token boundary', () => {
    const realisticKey = 'sk-1234567890abcdefghijklmnop'
    expect(redactSecrets(`Bearer ${realisticKey}`)).toBe('Bearer [REDACTED]')
    expect(redactSecrets(`Provider rejected ${realisticKey}...`)).toBe('Provider rejected [REDACTED]')
  })

  it.each(['mask-image', '-webkit-mask-size', 'sk-chase', 'https://example.com/task-1234'])(
    'does not alter non-credential text: %s',
    (value) => {
      expect(redactSecrets(value)).toBe(value)
    },
  )

  it('requires a non-token left boundary for pattern-based redaction', () => {
    const embedded = 'prefixsk-1234567890abcdefghijklmnop'
    expect(redactSecrets(embedded)).toBe(embedded)
  })
})

describe('OpenAI model access check', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('checks gpt-5.6-sol access without making a generation request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(checkOpenAIKey(apiKey)).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models/gpt-5.6-sol', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: expect.any(AbortSignal),
    })
  })

  it('cancels a stalled provider request at the bounded timeout and returns network', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined
        if (!observedSignal) return Promise.resolve(new Response('{}', { status: 200 }))
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener('abort', () => reject(new DOMException('Request timed out', 'AbortError')), {
            once: true,
          })
        })
      }),
    )

    const resultPromise = checkOpenAIKey(apiKey)
    await vi.advanceTimersByTimeAsync(OPENAI_KEY_CHECK_TIMEOUT_MS)

    await expect(resultPromise).resolves.toEqual({ ok: false, reason: 'network' })
    expect(observedSignal).toBeInstanceOf(AbortSignal)
    expect(observedSignal?.aborted).toBe(true)
  })

  it.each([
    [401, { error: { code: 'invalid_api_key' } }, 'invalid'],
    [400, { error: { code: 'invalid_api_key' } }, 'invalid'],
    [400, { error: { code: 'model_not_found' } }, 'model_access'],
    [403, { error: { code: 'model_not_found' } }, 'model_access'],
    [404, { error: { code: 'model_not_found' } }, 'model_access'],
    [429, { error: { code: 'insufficient_quota' } }, 'quota'],
    [429, { error: { code: 'rate_limit_exceeded' } }, 'rate_limited'],
    [400, { error: {} }, 'invalid_request'],
    [500, { error: {} }, 'provider_unavailable'],
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

  it('does not log or return provider response secrets at any sink', async () => {
    const uniqueSecretBody = `unique-provider-body-${apiKey}`
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: 'rate_limit_exceeded',
              message: uniqueSecretBody,
            },
            apiKey,
          },
          {
            status: 429,
            headers: {
              'x-provider-secret': uniqueSecretBody,
            },
          },
        ),
      ),
    )

    const result = await checkOpenAIKey(apiKey)
    const serialized = JSON.stringify(result)

    expect(result).toEqual({ ok: false, reason: 'rate_limited' })
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain(uniqueSecretBody)
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled()
    }
  })

  it('does not log or return secret-bearing provider exceptions', async () => {
    const uniqueSecretBody = `unique-provider-exception-${apiKey}`
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ]
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(uniqueSecretBody)))

    const result = await checkOpenAIKey(apiKey)
    const serialized = JSON.stringify(result)

    expect(result).toEqual({ ok: false, reason: 'network' })
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain(uniqueSecretBody)
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled()
    }
  })
})
