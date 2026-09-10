import { redactSecrets } from './redact'

export type ExternalRequestSource =
  | 'Codex agent'
  | 'Codex CLI'
  | 'OpenAI'
  | 'OpenRouter'
  | 'Vercel Blob'
  | 'Vercel Sandbox'

const loggedResponses = new WeakSet<Response>()

function safeText(value: string, secrets: readonly string[]): string {
  return redactSecrets(value, secrets)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function directResponseText(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    const candidate = asRecord(current)
    if (!candidate) break
    if (typeof candidate.responseBody === 'string') return candidate.responseBody
    if (typeof candidate.text === 'string') return candidate.text
    if (candidate.json !== undefined) {
      try {
        return JSON.stringify(candidate.json)
      } catch {
        return String(candidate.json)
      }
    }
    if (candidate.lastError !== undefined) {
      current = candidate.lastError
      continue
    }
    current = candidate.cause
  }

  return undefined
}

function containsLoggedResponse(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    const candidate = asRecord(current)
    if (!candidate) break
    if (
      candidate.response !== null &&
      typeof candidate.response === 'object' &&
      loggedResponses.has(candidate.response as Response)
    ) {
      return true
    }
    if (candidate.lastError !== undefined) {
      current = candidate.lastError
      continue
    }
    current = candidate.cause
  }

  return false
}

function transportErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

export function logExternalRequestError(
  source: ExternalRequestSource,
  error: unknown,
  secrets: readonly string[] = [],
): void {
  if (containsLoggedResponse(error)) return
  const responseText = directResponseText(error)
  console.error('External request failed:', source)
  if (responseText !== undefined) {
    console.error('External response body:', safeText(responseText, secrets))
    return
  }
  console.error('External transport error:', safeText(transportErrorText(error), secrets))
}

export function createExternalErrorLoggingFetch(
  source: ExternalRequestSource,
  secrets: readonly string[] = [],
  request: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    try {
      const response = await request(input, init)
      if (!response.ok) {
        loggedResponses.add(response)
        const responseText = await response
          .clone()
          .text()
          .catch((error: unknown) => transportErrorText(error))
        console.error('External request failed:', source)
        console.error('External response status:', response.status)
        console.error('External response body:', safeText(responseText, secrets))
      }
      return response
    } catch (error) {
      logExternalRequestError(source, error, secrets)
      throw error
    }
  }
}
