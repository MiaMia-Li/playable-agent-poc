import type { PlayableSandbox } from './sandbox-runner'
import { redactSecrets } from './redact'

const MAX_TEXT = 16_000
const MAX_COMMANDS = 8

/** Private diagnostic data only: never attach this to public activity events. */
export class SandboxDiagnostics {
  private readonly secrets: Set<string>
  private readonly commands: Array<{
    stage: string
    command: string
    durationMs: number
    exitCode?: number
    stdout?: string
    stderr?: string
    errors?: Array<{ name: string; message: string; stack?: string }>
  }> = []

  constructor(secrets: readonly string[] = []) {
    this.secrets = new Set([
      ...secrets,
      ...Object.entries(process.env)
        .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|POSTGRES_URL|TEAM_ID|PROJECT_ID/i.test(key))
        .map(([, value]) => value ?? ''),
    ])
  }

  private text(value: string): string {
    // Redact before truncation, including escaped values in JSON command output.
    const secrets = [...this.secrets].filter(Boolean).sort((a, b) => b.length - a.length)
    const safe = redactSecrets(
      value,
      secrets.flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]),
    )
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/\bgh[pousr]_[\w]+\b/g, '[REDACTED]')
      .replace(
        /(\b[\w-]*(?:key|token|secret|password|teamId|projectId)[\w-]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1"[REDACTED]"',
      )
    return safe.length > MAX_TEXT ? '[TRUNCATED]\n' + safe.slice(-MAX_TEXT) : safe
  }

  private errors(error: unknown) {
    const result: Array<{ name: string; message: string; stack?: string }> = []
    const seen = new Set<unknown>()
    let current = error
    while (current != null && !seen.has(current) && result.length < 6) {
      seen.add(current)
      if (!(current instanceof Error)) {
        result.push({ name: 'UnknownError', message: this.text(String(current)) })
        break
      }
      result.push({
        name: this.text(current.name),
        message: this.text(current.message),
        stack: this.text(current.stack ?? ''),
      })
      current = current.cause
    }
    return result
  }

  observe(sandbox: PlayableSandbox, stage: () => string): PlayableSandbox {
    const run: PlayableSandbox['run'] = async (options) => {
      for (const value of Object.values(options.env ?? {})) this.secrets.add(value)
      const startedAt = Date.now()
      const commandStage = stage()
      try {
        const result = await sandbox.run(options)
        if (result.exitCode !== 0) {
          this.commands.push({
            stage: commandStage,
            command: this.text(options.command),
            durationMs: Date.now() - startedAt,
            exitCode: result.exitCode,
            stdout: this.text(result.stdout ?? ''),
            stderr: this.text(result.stderr ?? ''),
          })
        }
        return result
      } catch (error) {
        this.commands.push({
          stage: commandStage,
          command: this.text(options.command),
          durationMs: Date.now() - startedAt,
          errors: this.errors(error),
        })
        throw error
      } finally {
        this.commands.splice(0, Math.max(0, this.commands.length - MAX_COMMANDS))
      }
    }
    return new Proxy(sandbox, {
      get(target, property) {
        if (property === 'run') return run
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  snapshot(stage: string, error: unknown, sandboxId?: string) {
    return {
      version: 1,
      recordedAt: new Date().toISOString(),
      stage,
      sandboxId,
      errors: this.errors(error),
      commands: this.commands.map((command) => ({ ...command })),
    }
  }
}
