import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Sandbox } from '@vercel/sandbox'
import { prepareSandboxForHarness } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { access, writeFile } from 'node:fs/promises'
import { preparePlayableSandbox } from '../../scripts/prepare-playable-sandbox'

vi.mock('dotenv', () => ({ config: vi.fn() }))
vi.mock('@vercel/sandbox', () => ({ Sandbox: { create: vi.fn() } }))
vi.mock('@ai-sdk/harness-codex', () => ({ createCodex: vi.fn(() => ({ harnessId: 'codex' })) }))
vi.mock('@ai-sdk/harness/agent', () => ({ prepareSandboxForHarness: vi.fn() }))
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
  vi.mocked(prepareSandboxForHarness).mockResolvedValue({
    recipeIdentities: { codex: 'recipe' },
    skippedHarnessIds: [],
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

function environments(restoredExitCode = 0) {
  const snapshot = { snapshotId: 'snap_verified', delete: vi.fn().mockResolvedValue(undefined) }
  const setup = {
    runCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
    writeFiles: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(snapshot),
    stop: vi.fn().mockResolvedValue(undefined),
  }
  const restored = {
    runCommand: vi.fn().mockResolvedValue({ exitCode: restoredExitCode }),
    stop: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(Sandbox.create)
    .mockResolvedValueOnce(setup as never)
    .mockResolvedValueOnce(restored as never)
  const harnessSession = { defaultWorkingDirectory: '/vercel/sandbox' }
  vi.mocked(createVercelSandbox).mockReturnValue({
    createSession: vi.fn().mockResolvedValue(harnessSession),
  } as never)
  return { snapshot, setup, restored, harnessSession }
}

it('saves configuration only after a restored browser passes and never uploads host credentials', async () => {
  const { setup, restored, snapshot, harnessSession } = environments()
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
  // 预装必须落在同一个待快照环境里，而不是另外创建一个沙盒。
  expect(createVercelSandbox).toHaveBeenCalledWith({ sandbox: setup })
  expect(prepareSandboxForHarness).toHaveBeenCalledWith(expect.objectContaining({ session: harnessSession }))
  // 校验必须针对本次配方的确切标记名，而不是「有没有某个标记」。
  expect(restored.runCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      env: {
        HARNESS_BOOTSTRAP_DIR: '/vercel/sandbox/.harness-bootstrap/codex',
        HARNESS_BOOTSTRAP_MARKER: '/vercel/sandbox/.harness-bootstrap/codex/.bootstrap-recipe.ok',
      },
    }),
  )
  expect(writeFile).toHaveBeenCalledWith(expect.any(String), 'PLAYABLE_SANDBOX_SNAPSHOT_ID=snap_verified\n', {
    flag: 'wx',
    mode: 0o600,
  })
  expect(setup.stop).toHaveBeenCalledOnce()
  expect(restored.stop).toHaveBeenCalledOnce()
  expect(snapshot.delete).not.toHaveBeenCalled()
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

it('does not snapshot when the harness bootstrap recipe is unavailable', async () => {
  const { setup } = environments()
  vi.mocked(prepareSandboxForHarness).mockResolvedValue({ recipeIdentities: {}, skippedHarnessIds: ['codex'] })
  await expect(preparePlayableSandbox()).rejects.toThrow('Harness bootstrap recipe is unavailable')
  expect(setup.snapshot).not.toHaveBeenCalled()
  expect(writeFile).not.toHaveBeenCalled()
  expect(setup.stop).toHaveBeenCalledOnce()
})

// 没有配方指纹就无法判断构建会去找哪个标记，此时快照的预装价值不可验证。
it('does not snapshot when the recipe fingerprint is missing', async () => {
  const { setup } = environments()
  vi.mocked(prepareSandboxForHarness).mockResolvedValue({ recipeIdentities: {}, skippedHarnessIds: [] })
  await expect(preparePlayableSandbox()).rejects.toThrow('Harness bootstrap recipe is unavailable')
  expect(setup.snapshot).not.toHaveBeenCalled()
  expect(writeFile).not.toHaveBeenCalled()
})
