import type { NextRequest } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import type { Session } from '@/lib/session/types'
import { isLocalPlayableAuthMode, localCodexSession } from './local-codex-runtime'

export async function getOpenAIKeyRouteSession(request: NextRequest): Promise<Session | undefined> {
  return isLocalPlayableAuthMode() ? localCodexSession : await getSessionFromReq(request)
}
