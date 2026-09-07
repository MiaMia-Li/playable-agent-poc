import type { NextRequest } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import { PLAYABLE_OPENAI_MODEL, readOpenAIKeyCookie } from '@/lib/playable/byok-session'

export async function GET(request: NextRequest) {
  const session = await getSessionFromReq(request)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = await readOpenAIKeyCookie(request, session.user.id)
  return Response.json({
    configured: apiKey !== undefined,
    model: PLAYABLE_OPENAI_MODEL,
  })
}
