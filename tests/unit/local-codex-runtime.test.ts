import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalCodexMode, isLocalHarnessMode, isLocalPlayableAuthMode } from '@/lib/playable/local-codex-runtime'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local Codex runtime', () => {
  it('stays enabled in development when pulled Vercel variables are present', () => {
    vi.stubEnv('LOCAL_CODEX_MODE', '1')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL', '1')

    expect(isLocalCodexMode()).toBe(true)
  })

  it('cannot bypass authentication in production', () => {
    vi.stubEnv('LOCAL_CODEX_MODE', '1')
    vi.stubEnv('NODE_ENV', 'production')

    expect(isLocalCodexMode()).toBe(false)
  })

  it('enables production-parity Harness with local authentication only in development', () => {
    vi.stubEnv('LOCAL_HARNESS_MODE', '1')
    vi.stubEnv('NODE_ENV', 'development')

    expect(isLocalHarnessMode()).toBe(true)
    expect(isLocalPlayableAuthMode()).toBe(true)

    vi.stubEnv('NODE_ENV', 'production')
    expect(isLocalHarnessMode()).toBe(false)
    expect(isLocalPlayableAuthMode()).toBe(false)
  })
})
