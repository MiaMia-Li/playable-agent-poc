import { describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  const onConflictDoNothing = vi.fn(() => Promise.resolve())
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const insert = vi.fn(() => ({ values }))
  return { insert, values, onConflictDoNothing }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({ db: { insert: database.insert } }))

import {
  authenticatePublicPlayable,
  PUBLIC_PLAYABLE_USER_ID,
  publicPlayableSession,
} from '@/lib/playable/public-access'

describe('public playable access', () => {
  it('creates one shared database identity and reuses it for every request', async () => {
    await expect(authenticatePublicPlayable()).resolves.toBe(PUBLIC_PLAYABLE_USER_ID)
    await expect(authenticatePublicPlayable()).resolves.toBe(PUBLIC_PLAYABLE_USER_ID)

    expect(publicPlayableSession.user.id).toBe(PUBLIC_PLAYABLE_USER_ID)
    expect(database.insert).toHaveBeenCalledOnce()
    expect(database.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PUBLIC_PLAYABLE_USER_ID,
        externalId: PUBLIC_PLAYABLE_USER_ID,
        accessToken: '',
      }),
    )
    expect(database.onConflictDoNothing).toHaveBeenCalledOnce()
  })
})
