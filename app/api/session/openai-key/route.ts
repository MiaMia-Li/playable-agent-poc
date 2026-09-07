import type { NextRequest } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import { clearOpenAIKeyCookie, PLAYABLE_OPENAI_MODEL, setOpenAIKeyCookie } from '@/lib/playable/byok-session'
import { checkOpenAIKey } from '@/lib/playable/openai-key-check'

export async function PUT(request: NextRequest) {
  const session = await getSessionFromReq(request)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => undefined)) as { apiKey?: unknown } | undefined
  if (typeof body?.apiKey !== 'string' || body.apiKey.length === 0) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = await checkOpenAIKey(body.apiKey)
  if (!result.ok) {
    return Response.json(result, { status: 400 })
  }

  const response = Response.json({ configured: true, model: PLAYABLE_OPENAI_MODEL })
  await setOpenAIKeyCookie(response, session.user.id, body.apiKey)
  return response
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromReq(request)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const response = Response.json({ configured: false, model: PLAYABLE_OPENAI_MODEL })
  clearOpenAIKeyCookie(response)
  return response
}
