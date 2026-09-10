import { describe, expect, it, vi } from 'vitest'
import {
  checkVercelSandboxConnectivity,
  VercelSandboxConnectivityError,
} from '@/lib/sandbox/vercel-sandbox-connectivity'

describe('Vercel Sandbox connectivity', () => {
  it('checks DNS before probing the Sandbox API endpoint', async () => {
    const lookup = vi.fn(async () => [{ address: '192.0.2.1', family: 4 }])
    const probe = vi.fn(async () => undefined)

    await expect(checkVercelSandboxConnectivity({ lookup, probe })).resolves.toBeUndefined()
    expect(lookup).toHaveBeenCalledWith('vercel.com', { all: true })
    expect(probe).toHaveBeenCalledWith(
      'https://vercel.com/api',
      expect.objectContaining({ method: 'HEAD', signal: expect.any(AbortSignal) }),
    )
    expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(probe.mock.invocationCallOrder[0])
  })

  it('reports DNS failures without attempting the HTTPS probe', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('lookup failed')
    })
    const probe = vi.fn(async () => undefined)

    await expect(checkVercelSandboxConnectivity({ lookup, probe })).rejects.toMatchObject({
      code: 'sandbox_dns_failed',
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('reports HTTPS egress failures separately from DNS failures', async () => {
    const lookup = vi.fn(async () => [{ address: '192.0.2.1', family: 4 }])
    const probe = vi.fn(async () => {
      throw new Error('connection failed')
    })

    await expect(checkVercelSandboxConnectivity({ lookup, probe })).rejects.toBeInstanceOf(
      VercelSandboxConnectivityError,
    )
    await expect(checkVercelSandboxConnectivity({ lookup, probe })).rejects.toMatchObject({
      code: 'sandbox_https_egress_failed',
    })
  })
})
