import type { NextRequest } from 'next/server'
import type { Session } from '@/lib/session/types'
import { isLocalPlayableAuthMode, localCodexSession } from './local-codex-runtime'
import { publicPlayableSession } from './public-access'

export async function getOpenAIKeyRouteSession(_request: NextRequest): Promise<Session> {
  return isLocalPlayableAuthMode() ? localCodexSession : publicPlayableSession
}
