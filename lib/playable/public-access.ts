import 'server-only'

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import type { Session } from '@/lib/session/types'

export const PUBLIC_PLAYABLE_USER_ID = 'public-playable-poc-user'

export const publicPlayableSession: Session = {
  created: 0,
  authProvider: 'vercel',
  user: {
    id: PUBLIC_PLAYABLE_USER_ID,
    username: 'playable-guest',
    email: undefined,
    avatar: '',
    name: '公开体验',
  },
}

let publicUserReady: Promise<void> | undefined

export async function ensurePublicPlayableUser(): Promise<void> {
  publicUserReady ??= db
    .insert(users)
    .values({
      id: PUBLIC_PLAYABLE_USER_ID,
      provider: 'vercel',
      externalId: PUBLIC_PLAYABLE_USER_ID,
      accessToken: '',
      username: publicPlayableSession.user.username,
      name: publicPlayableSession.user.name,
    })
    .onConflictDoNothing()
    .then(() => undefined)
    .catch((cause) => {
      publicUserReady = undefined
      throw cause
    })
  return publicUserReady
}

export async function authenticatePublicPlayable(_request?: NextRequest): Promise<string> {
  await ensurePublicPlayableUser()
  return PUBLIC_PLAYABLE_USER_ID
}
