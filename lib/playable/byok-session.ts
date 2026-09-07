import { decryptJWE } from '@/lib/jwe/decrypt'
import { encryptJWE } from '@/lib/jwe/encrypt'

export const OPENAI_KEY_COOKIE = '__Host-playable-openai-key'
export const OPENAI_KEY_TTL = '2h'
export const PLAYABLE_OPENAI_MODEL = 'gpt-5.6-sol' as const

const OPENAI_KEY_MAX_AGE = 60 * 60 * 2

interface OpenAIKeySession {
  userId: string
  apiKey: string
  model: typeof PLAYABLE_OPENAI_MODEL
}

interface CookieRequest {
  cookies: {
    get(name: string): { value: string } | undefined
  }
}

function cookieSecurityAttributes(): string {
  return `HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict`
}

export async function encryptOpenAIKey(userId: string, apiKey: string, secret?: string): Promise<string> {
  const payload: OpenAIKeySession = {
    userId,
    apiKey,
    model: PLAYABLE_OPENAI_MODEL,
  }
  return encryptJWE(payload, OPENAI_KEY_TTL, secret)
}

export async function decryptOpenAIKey(token: string, secret?: string): Promise<OpenAIKeySession | undefined> {
  const payload = await decryptJWE<OpenAIKeySession>(token, secret)
  if (
    !payload ||
    typeof payload.userId !== 'string' ||
    typeof payload.apiKey !== 'string' ||
    payload.model !== PLAYABLE_OPENAI_MODEL
  ) {
    return
  }
  return payload
}

export async function setOpenAIKeyCookie(
  response: Response,
  userId: string,
  apiKey: string,
  secret?: string,
): Promise<string> {
  const token = await encryptOpenAIKey(userId, apiKey, secret)
  response.headers.append(
    'Set-Cookie',
    `${OPENAI_KEY_COOKIE}=${token}; Path=/; Max-Age=${OPENAI_KEY_MAX_AGE}; ${cookieSecurityAttributes()}`,
  )
  return token
}

export async function readOpenAIKeyCookie(
  request: CookieRequest,
  authenticatedUserId: string,
  secret?: string,
): Promise<string | undefined> {
  const token = request.cookies.get(OPENAI_KEY_COOKIE)?.value
  if (!token) return

  const payload = await decryptOpenAIKey(token, secret)
  if (payload?.userId !== authenticatedUserId) return
  return payload.apiKey
}

export function clearOpenAIKeyCookie(response: Response): void {
  response.headers.append('Set-Cookie', `${OPENAI_KEY_COOKIE}=; Path=/; Max-Age=0; ${cookieSecurityAttributes()}`)
}
