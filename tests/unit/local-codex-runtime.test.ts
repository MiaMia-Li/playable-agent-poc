import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalCodexMode } from '@/lib/playable/local-codex-runtime'

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
})
