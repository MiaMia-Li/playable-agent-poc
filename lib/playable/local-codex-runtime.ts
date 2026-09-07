import type { NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import type { Session } from '@/lib/session/types'

const LOCAL_CODEX_USER_ID = 'local-codex-development-user'
const LOCAL_CODEX_AUTH_MARKER = 'local-codex-cli-session'

export const localCodexSession: Session = {
  created: 0,
  authProvider: 'vercel',
  user: {
    id: LOCAL_CODEX_USER_ID,
    username: 'local-codex',
    email: undefined,
    avatar: '',
    name: 'Local Codex',
  },
}

export function isLocalCodexMode(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_CODEX_MODE === '1'
}

let localUserReady: Promise<void> | undefined

async function ensureLocalCodexUser(): Promise<void> {
  localUserReady ??= db
    .insert(users)
    .values({
      id: LOCAL_CODEX_USER_ID,
      provider: 'vercel',
      externalId: LOCAL_CODEX_USER_ID,
      accessToken: '',
      username: 'local-codex',
      name: 'Local Codex',
    })
    .onConflictDoNothing()
    .then(() => undefined)
  return localUserReady
}

export async function authenticateLocalCodex(_request?: NextRequest): Promise<string> {
  await ensureLocalCodexUser()
  return LOCAL_CODEX_USER_ID
}

export async function readLocalCodexAuthMarker(): Promise<string> {
  return LOCAL_CODEX_AUTH_MARKER
}
