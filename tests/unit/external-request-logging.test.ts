import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExternalErrorLoggingFetch, logExternalRequestError } from '@/lib/playable/external-request-logging'

describe('external request logging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the untouched response body and leaves it available to the caller', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const request = createExternalErrorLoggingFetch(
      'Vercel Sandbox',
      [],
      vi.fn(async () => new Response('{"error":"sandbox unavailable"}', { status: 503 })),
    )

    const response = await request('https://example.test/sandbox')

    expect(errorSpy).toHaveBeenCalledWith('External request failed:', 'Vercel Sandbox')
    expect(errorSpy).toHaveBeenCalledWith('External response status:', 503)
    expect(errorSpy).toHaveBeenCalledWith('External response body:', '{"error":"sandbox unavailable"}')
    await expect(response.text()).resolves.toBe('{"error":"sandbox unavailable"}')
  })

  it('prefers an SDK error response body over its mapped message', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = Object.assign(new Error('mapped provider error'), {
      responseBody: '{"error":{"message":"direct provider error"}}',
    })

    logExternalRequestError('OpenAI', error)

    expect(errorSpy).toHaveBeenCalledWith('External response body:', '{"error":{"message":"direct provider error"}}')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('mapped provider error')
  })

  it('does not print the same response again after an SDK wraps it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = new Response('{"error":"invalid token"}', { status: 401 })
    const request = createExternalErrorLoggingFetch(
      'Vercel Sandbox',
      [],
      vi.fn(async () => response),
    )

    await request('https://example.test/sandbox')
    logExternalRequestError('Vercel Sandbox', Object.assign(new Error('mapped error'), { response }))

    expect(errorSpy).toHaveBeenCalledTimes(3)
  })
})
