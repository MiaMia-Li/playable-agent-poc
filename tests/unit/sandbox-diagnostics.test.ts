import { describe, expect, it, vi } from 'vitest'
import { SandboxDiagnostics } from '@/lib/playable/sandbox-diagnostics'
import type { PlayableSandbox } from '@/lib/playable/sandbox-runner'

function sandbox(run: PlayableSandbox['run']) {
  return { run, destroy: vi.fn(), defaultWorkingDirectory: '/work' } as unknown as PlayableSandbox
}

describe('private Sandbox diagnostics', () => {
  it('retains failed output and exit code without changing execution or exposing credentials', async () => {
    const diagnostics = new SandboxDiagnostics(['server-secret'])
    const result = {
      exitCode: 127,
      stdout: 'server-secret',
      stderr: 'node: not found; Bearer unknown-token env-secret',
    }
    const observed = diagnostics.observe(sandbox(vi.fn().mockResolvedValue(result)), () => 'workspace')
    expect(await observed.run({ command: 'node server-secret', env: { CUSTOM_AUTH: 'env-secret' } })).toBe(result)
    const snapshot = diagnostics.snapshot('workspace', new Error('setup failed'))
    expect(snapshot.commands[0]).toMatchObject({
      exitCode: 127,
      stage: 'workspace',
      stderr: 'node: not found; Bearer [REDACTED] [REDACTED]',
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/server-secret|env-secret|unknown-token/)
  })

  it('bounds failures and redacts secrets before truncation', async () => {
    const secret = 'a-very-long-private-token'
    const diagnostics = new SandboxDiagnostics([secret])
    const observed = diagnostics.observe(
      sandbox(
        vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'x'.repeat(16000) + secret + 'y'.repeat(15990) }),
      ),
      () => 'agent',
    )
    for (let i = 0; i < 10; i++) await observed.run({ command: 'test' })
    const snapshot = diagnostics.snapshot('agent', new Error('failed'))
    expect(snapshot.commands).toHaveLength(8)
    expect(snapshot.commands[0].stderr).toHaveLength(16012)
    expect(snapshot.commands[0].stderr).not.toContain('private-token')
  })

  it('preserves thrown errors and handles cyclic cause chains', async () => {
    const error = new Error('transport failed')
    error.cause = error
    const diagnostics = new SandboxDiagnostics()
    const observed = diagnostics.observe(sandbox(vi.fn().mockRejectedValue(error)), () => 'workspace')
    await expect(observed.run({ command: 'test' })).rejects.toBe(error)
    const snapshot = diagnostics.snapshot('workspace', error)
    expect(snapshot.errors).toHaveLength(1)
    expect(snapshot.commands[0].errors?.[0].message).toBe('transport failed')
  })

  it('does not collect successful command output and binds underlying methods', async () => {
    const original = sandbox(vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'private success', stderr: '' }))
    original.destroy = function () {
      expect(this).toBe(original)
      return Promise.resolve()
    }
    const diagnostics = new SandboxDiagnostics()
    const observed = diagnostics.observe(original, () => 'agent')
    await observed.run({ command: 'test' })
    await observed.destroy()
    expect(diagnostics.snapshot('agent', new Error('failed')).commands).toEqual([])
  })
})
