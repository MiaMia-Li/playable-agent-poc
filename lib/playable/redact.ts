const OPENAI_KEY_PATTERN = /(^|[^A-Za-z0-9_-])(sk-[A-Za-z0-9_-]{20,}(?:\.\.\.)?)/g

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.replaceAll(secret, '[REDACTED]')
    }
  }
  return redacted.replace(OPENAI_KEY_PATTERN, '$1[REDACTED]')
}
