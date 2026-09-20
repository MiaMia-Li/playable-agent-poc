import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIError, Sandbox } from '@vercel/sandbox'
import { readBuildSandboxState } from '@/lib/playable/build-sandbox-state'

vi.mock('@vercel/sandbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/sandbox')>()),
  Sandbox: { get: vi.fn() },
}))

afterEach(() => vi.restoreAllMocks())

describe('build sandbox liveness', () => {
  it.each(['running', 'pending', 'stopping', 'snapshotting', 'stopped', 'failed', 'aborted'])(
    'inspects %s without resuming it',
    async (status) => {
      vi.mocked(Sandbox.get).mockResolvedValue({ status } as Sandbox)
      expect(await readBuildSandboxState('sandbox-test')).toBe(
        ['stopped', 'failed', 'aborted'].includes(status) ? 'stopped' : 'active',
      )
      expect(Sandbox.get).toHaveBeenCalledWith(expect.objectContaining({ name: 'sandbox-test', resume: false }))
    },
  )

  // 仅 404 能确认沙箱已删除，服务不可达或权限异常都不能当作构建终止证据。
  it.each([404, 401, 429, 500])('handles HTTP %s conservatively', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(Sandbox.get).mockRejectedValue(new APIError(new Response(null, { status })))
    expect(await readBuildSandboxState('sandbox-test')).toBe(status === 404 ? 'stopped' : 'unknown')
  })

  it('does not infer termination from a timeout or expose the error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(Sandbox.get).mockRejectedValue(new Error('private credentials'))
    expect(await readBuildSandboxState('sandbox-test')).toBe('unknown')
    expect(log).toHaveBeenCalledWith('Unable to inspect playable build sandbox')
  })
})
