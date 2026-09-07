const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9_-]{4,}(?:\.\.\.)?/g

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.replaceAll(secret, '[REDACTED]')
    }
  }
  return redacted.replace(OPENAI_KEY_PATTERN, '[REDACTED]')
}
