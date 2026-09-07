import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encryptOpenAIKey, OPENAI_KEY_COOKIE } from '@/lib/playable/byok-session'

const { getSessionFromReq, checkOpenAIKey, saveSession } = vi.hoisted(() => ({
  getSessionFromReq: vi.fn(),
  checkOpenAIKey: vi.fn(),
  saveSession: vi.fn((response: Response) => {
    response.headers.append(
      'Set-Cookie',
      '_user_session_=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
    )
  }),
}))

vi.mock('@/lib/session/server', () => ({ getSessionFromReq }))
vi.mock('@/lib/playable/openai-key-check', () => ({ checkOpenAIKey }))
vi.mock('@/lib/session/create', () => ({ saveSession }))
vi.mock('@/lib/session/get-oauth-token', () => ({ getOAuthToken: vi.fn() }))

import { DELETE, PUT } from '@/app/api/session/openai-key/route'
import { GET as GET_CHECK } from '@/app/api/session/openai-key/check/route'
import { GET as GET_SIGNOUT } from '@/app/api/auth/signout/route'

const jweSecret = Buffer.alloc(32, 9).toString('base64url')
const session = {
  created: Date.now(),
  authProvider: 'github',
  user: {
    id: 'user-123',
    username: 'test-user',
    email: 'test@example.com',
    name: 'Test User',
    avatar: 'https://example.com/avatar.png',
  },
}

describe('OpenAI key session routes', () => {
  beforeEach(() => {
    vi.stubEnv('JWE_SECRET', jweSecret)
    getSessionFromReq.mockReset()
    checkOpenAIKey.mockReset()
    getSessionFromReq.mockResolvedValue(session)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires authentication for every operation', async () => {
    getSessionFromReq.mockResolvedValue(undefined)
    const putRequest = new NextRequest('https://example.com/api/session/openai-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-test-secret' }),
    })
    const deleteRequest = new NextRequest('https://example.com/api/session/openai-key', { method: 'DELETE' })
    const checkRequest = new NextRequest('https://example.com/api/session/openai-key/check')

    await expect(PUT(putRequest)).resolves.toHaveProperty('status', 401)
    await expect(DELETE(deleteRequest)).resolves.toHaveProperty('status', 401)
    await expect(GET_CHECK(checkRequest)).resolves.toHaveProperty('status', 401)
    expect(checkOpenAIKey).not.toHaveBeenCalled()
  })

  it('validates a fake key and stores only its encrypted user-bound value', async () => {
    checkOpenAIKey.mockResolvedValue({ ok: true })
    const request = new NextRequest('https://example.com/api/session/openai-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-test-secret' }),
    })

    const response = await PUT(request)
    const body = await response.json()
    const setCookie = response.headers.get('set-cookie')

    expect(response.status).toBe(200)
    expect(body).toEqual({ configured: true, model: 'gpt-5.6-sol' })
    expect(checkOpenAIKey).toHaveBeenCalledWith('sk-test-secret')
    expect(setCookie).toContain(`${OPENAI_KEY_COOKIE}=`)
    expect(setCookie).not.toContain('sk-test-secret')
  })

  it('does not set a cookie or echo provider details when validation fails', async () => {
    checkOpenAIKey.mockResolvedValue({ ok: false, reason: 'invalid' })
    const request = new NextRequest('https://example.com/api/session/openai-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-test-secret' }),
    })

    const response = await PUT(request)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, reason: 'invalid' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('allowlists validation failures at the route response and logging sinks', async () => {
    const apiKey = 'sk-test-route-secret'
    const uniqueSecretBody = `unique-route-provider-body-${apiKey}`
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ]
    checkOpenAIKey.mockResolvedValue({
      ok: false,
      reason: 'network',
      providerBody: uniqueSecretBody,
      providerHeaders: { authorization: `Bearer ${apiKey}` },
    })
    const request = new NextRequest('https://example.com/api/session/openai-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    })

    const response = await PUT(request)
    const serialized = JSON.stringify(await response.json())

    expect(serialized).toBe(JSON.stringify({ ok: false, reason: 'network' }))
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain(uniqueSecretBody)
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled()
    }
  })

  it('clears the key cookie for an authenticated user', async () => {
    const request = new NextRequest('https://example.com/api/session/openai-key', { method: 'DELETE' })

    const response = await DELETE(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: false, model: 'gpt-5.6-sol' })
    expect(response.headers.get('set-cookie')).toContain(`${OPENAI_KEY_COOKIE}=`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('reports configuration only when the cookie belongs to the authenticated user', async () => {
    const token = await encryptOpenAIKey(session.user.id, 'sk-test-secret', jweSecret)
    const request = new NextRequest('https://example.com/api/session/openai-key/check', {
      headers: { cookie: `${OPENAI_KEY_COOKIE}=${token}` },
    })

    const configuredResponse = await GET_CHECK(request)
    expect(await configuredResponse.json()).toEqual({ configured: true, model: 'gpt-5.6-sol' })

    getSessionFromReq.mockResolvedValue({ ...session, user: { ...session.user, id: 'another-user' } })
    const mismatchedResponse = await GET_CHECK(request)
    expect(await mismatchedResponse.json()).toEqual({ configured: false, model: 'gpt-5.6-sol' })
  })

  it('clears the OpenAI key cookie in the same sign-out response as the auth cookie', async () => {
    getSessionFromReq.mockResolvedValue(undefined)
    const request = new NextRequest('https://example.com/api/auth/signout?next=/')

    const response = await GET_SIGNOUT(request)
    const setCookie = response.headers.get('set-cookie')

    expect(setCookie).toContain('_user_session_=')
    expect(setCookie).toContain(`${OPENAI_KEY_COOKIE}=`)
    expect(setCookie).toContain('Max-Age=0')
  })
})
