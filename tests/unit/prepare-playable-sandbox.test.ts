import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prepareSandboxForHarness } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { Sandbox } from '@vercel/sandbox'
import { access, writeFile } from 'node:fs/promises'
import { preparePlayableSandbox } from '../../scripts/prepare-playable-sandbox'

vi.mock('dotenv', () => ({ config: vi.fn() }))
vi.mock('@vercel/sandbox', () => ({ Sandbox: { create: vi.fn() } }))
vi.mock('@ai-sdk/harness/agent', () => ({ prepareSandboxForHarness: vi.fn() }))
vi.mock('@ai-sdk/harness-codex', () => ({ codex: { harnessId: 'codex' } }))
vi.mock('@ai-sdk/sandbox-vercel', () => ({ createVercelSandbox: vi.fn() }))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  access: vi.fn(),
  writeFile: vi.fn(),
}))

beforeEach(() => {
  vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'test-credential')
  vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'test-team')
  vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'test-project')
  vi.mocked(access).mockRejectedValue(new Error('missing'))
  vi.mocked(writeFile).mockResolvedValue(undefined)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(createVercelSandbox).mockReturnValue({
    createSession: vi.fn().mockResolvedValue({ kind: 'setup-session' }),
  } as never)
  vi.mocked(prepareSandboxForHarness).mockResolvedValue({
    recipeIdentities: { codex: 'recipe123' },
    skippedHarnessIds: [],
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

function environments(restoredExitCode = 0, markerExitCode = 0) {
  const snapshot = { snapshotId: 'snap_verified', delete: vi.fn().mockResolvedValue(undefined) }
  const setup = {
    runCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
    writeFiles: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(snapshot),
    stop: vi.fn().mockResolvedValue(undefined),
  }
  const restored = {
    runCommand: vi.fn(async ({ cmd }: { cmd: string }) => ({
      exitCode: cmd === 'test' ? markerExitCode : restoredExitCode,
    })),
    currentSession: () => ({ cwd: '/vercel/sandbox' }),
    stop: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(Sandbox.create)
    .mockResolvedValueOnce(setup as never)
    .mockResolvedValueOnce(restored as never)
  return { snapshot, setup, restored }
}

it('saves configuration only after a restored browser passes and never uploads host credentials', async () => {
  const { setup, restored, snapshot } = environments()
  await preparePlayableSandbox()
  expect(Sandbox.create).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      source: { type: 'snapshot', snapshotId: 'snap_verified' },
      persistent: false,
    }),
  )
  for (const [settings] of vi.mocked(Sandbox.create).mock.calls) expect(settings).not.toHaveProperty('env')
  const uploaded = setup.writeFiles.mock.calls[0][0] as Array<{ content: Buffer }>
  expect(uploaded.map((file) => file.content.toString()).join('')).not.toContain('test-credential')
  expect(setup.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      args: expect.arrayContaining(['install', '--with-deps', 'chromium']),
      env: { PLAYWRIGHT_BROWSERS_PATH: '0' },
    }),
  )
  expect(restored.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({ args: expect.arrayContaining(['--launch']) }),
  )
  expect(writeFile).toHaveBeenCalledWith(expect.any(String), 'PLAYABLE_SANDBOX_SNAPSHOT_ID=snap_verified\n', {
    flag: 'wx',
    mode: 0o600,
  })
  expect(setup.stop).toHaveBeenCalledOnce()
  expect(restored.stop).toHaveBeenCalledOnce()
  expect(snapshot.delete).not.toHaveBeenCalled()
})

it('pre-installs the Codex bridge before the snapshot and verifies its marker after restore', async () => {
  const { setup, restored } = environments()
  await preparePlayableSandbox()
  expect(createVercelSandbox).toHaveBeenCalledWith({ sandbox: setup })
  expect(prepareSandboxForHarness).toHaveBeenCalledWith({
    session: { kind: 'setup-session' },
    harnesses: [{ harnessId: 'codex' }],
  })
  expect(vi.mocked(prepareSandboxForHarness).mock.invocationCallOrder[0]).toBeLessThan(
    setup.snapshot.mock.invocationCallOrder[0],
  )
  expect(restored.runCommand).toHaveBeenCalledWith({
    cmd: 'test',
    args: ['-f', '/vercel/sandbox/.harness-bootstrap/codex/.bootstrap-recipe123.ok'],
  })
})

it('rejects a snapshot whose restored environment lacks the Codex bridge', async () => {
  const { snapshot } = environments(0, 1)
  await expect(preparePlayableSandbox()).rejects.toThrow('Restored Codex bridge check failed')
  expect(writeFile).not.toHaveBeenCalled()
  expect(snapshot.delete).toHaveBeenCalledOnce()
})

it('does not snapshot when the Codex bridge install fails and keeps credentials out of the log', async () => {
  const { setup } = environments()
  vi.mocked(prepareSandboxForHarness).mockRejectedValueOnce(new Error('pnpm failed: test-credential'))
  await expect(preparePlayableSandbox()).rejects.toThrow('setup command failed')
  expect(setup.snapshot).not.toHaveBeenCalled()
  expect(setup.stop).toHaveBeenCalledOnce()
  expect(vi.mocked(writeFile).mock.calls[0][1]).not.toContain('test-credential')
})

it('deletes a failed snapshot and never enables it', async () => {
  const { setup, restored, snapshot } = environments(1)
  await expect(preparePlayableSandbox()).rejects.toThrow('Restored browser check failed')
  expect(writeFile).not.toHaveBeenCalled()
  expect(snapshot.delete).toHaveBeenCalledOnce()
  expect(setup.stop).toHaveBeenCalledOnce()
  expect(restored.stop).toHaveBeenCalledOnce()
})

it('does not create cloud resources when a configuration already exists', async () => {
  vi.mocked(access).mockResolvedValue(undefined)
  await expect(preparePlayableSandbox()).rejects.toThrow('configuration already exists')
  expect(Sandbox.create).not.toHaveBeenCalled()
})

it('stops setup immediately when installation fails and does not snapshot', async () => {
  const { setup } = environments()
  setup.runCommand.mockResolvedValueOnce({ exitCode: 1, output: async () => 'Install failed: test-credential' })
  await expect(preparePlayableSandbox()).rejects.toThrow('setup command failed')
  expect(setup.snapshot).not.toHaveBeenCalled()
  expect(setup.stop).toHaveBeenCalledOnce()
  expect(writeFile).toHaveBeenCalledWith('.playable-sandbox-setup.log', expect.any(String), { mode: 0o600 })
  expect(vi.mocked(writeFile).mock.calls[0][1]).not.toContain('test-credential')
  expect(vi.mocked(writeFile).mock.calls.some(([file]) => String(file).endsWith('.env.playable-sandbox.local'))).toBe(
    false,
  )
})
