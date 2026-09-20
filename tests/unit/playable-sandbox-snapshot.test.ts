import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { createPlayableSandbox } from '@/lib/playable/sandbox-runner'
import { PLAYABLE_SANDBOX_TOOLS_VERSION } from '@/lib/playable/sandbox-tools'

vi.mock('@ai-sdk/sandbox-vercel', () => ({ createVercelSandbox: vi.fn() }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

function provider(exitCode = 0) {
  const sandbox = { run: vi.fn().mockResolvedValue({ exitCode }), destroy: vi.fn().mockResolvedValue(undefined) }
  const createSession = vi.fn().mockResolvedValue(sandbox)
  vi.mocked(createVercelSandbox).mockReturnValue({ createSession } as never)
  return { sandbox, createSession }
}

describe('playable snapshot startup', () => {
  it('keeps the legacy runtime when no snapshot is configured', async () => {
    vi.stubEnv('PLAYABLE_SANDBOX_SNAPSHOT_ID', '')
    const { sandbox } = provider()
    expect(await createPlayableSandbox('test')).toBe(sandbox)
    expect(createVercelSandbox).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'node24', persistent: false }))
    expect(sandbox.run).not.toHaveBeenCalled()
  })

  it('restores a fresh snapshot without sending a conflicting runtime, then checks installed tools', async () => {
    vi.stubEnv('PLAYABLE_SANDBOX_SNAPSHOT_ID', '  snap_test  ')
    const { sandbox, createSession } = provider()
    const signal = new AbortController().signal
    expect(await createPlayableSandbox('test', signal)).toBe(sandbox)
    const settings = vi.mocked(createVercelSandbox).mock.calls[0][0]
    expect(settings).toMatchObject({ source: { type: 'snapshot', snapshotId: 'snap_test' }, persistent: false })
    expect(settings).not.toHaveProperty('runtime')
    // 名称保留任务前缀并增加随机后缀，断言格式而不固定某次生成的值。
    expect(createSession).toHaveBeenCalledWith({
      sessionId: expect.stringMatching(/^test-[a-f0-9-]+$/),
      abortSignal: signal,
    })
    expect(sandbox.run).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { PLAYABLE_TOOLS_EXPECTED_VERSION: PLAYABLE_SANDBOX_TOOLS_VERSION },
        abortSignal: signal,
      }),
    )
  })

  it('cleans up incompatible snapshots and does not silently reinstall or fall back', async () => {
    vi.stubEnv('PLAYABLE_SANDBOX_SNAPSHOT_ID', 'snap_test')
    const { sandbox } = provider(1)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(createPlayableSandbox('test')).rejects.toThrow('rebuild the snapshot')
      expect(sandbox.destroy).toHaveBeenCalledOnce()
      expect(createVercelSandbox).toHaveBeenCalledOnce()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
