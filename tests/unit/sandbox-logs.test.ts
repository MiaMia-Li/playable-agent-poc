import { describe, expect, it, vi } from 'vitest'
import { downloadTaskSandboxLogs, type SandboxLogsDependencies } from '../../scripts/sandbox-logs'

function dependencies(): SandboxLogsDependencies {
  return {
    findLatestFailedBuild: vi.fn().mockResolvedValue({ userId: 'owner', taskId: 'task-123', buildId: 'failed-build' }),
    download: vi.fn().mockResolvedValue('{"version":1}'),
    save: vi.fn().mockResolvedValue(undefined),
  }
}

describe('sandbox:logs task lookup', () => {
  it('downloads the selected failed build using the owner from the database', async () => {
    const deps = dependencies()
    await downloadTaskSandboxLogs(['task-123'], deps)
    expect(deps.findLatestFailedBuild).toHaveBeenCalledWith('task-123')
    expect(deps.download).toHaveBeenCalledWith('users/owner/tasks/task-123/failed-build/sandbox-diagnostics.json')
    expect(deps.save).toHaveBeenCalledWith('task-123', '{"version":1}')
  })

  it.each([[], ['../escape'], ['task', 'extra']])(
    'rejects invalid arguments before accessing services: %j',
    async (...args) => {
      const deps = dependencies()
      await expect(downloadTaskSandboxLogs(args, deps)).rejects.toThrow('Usage:')
      expect(deps.findLatestFailedBuild).not.toHaveBeenCalled()
    },
  )

  it('explains missing tasks or failed builds without accessing Blob', async () => {
    const deps = dependencies()
    vi.mocked(deps.findLatestFailedBuild).mockResolvedValue(undefined)
    await expect(downloadTaskSandboxLogs(['task-123'], deps)).rejects.toThrow('no failed build')
    expect(deps.download).not.toHaveBeenCalled()
  })

  it('reports missing diagnostics without replacing local logs or falling back', async () => {
    const deps = dependencies()
    vi.mocked(deps.download).mockResolvedValue(undefined)
    await expect(downloadTaskSandboxLogs(['task-123'], deps)).rejects.toThrow('latest failed build has no diagnostics')
    expect(deps.download).toHaveBeenCalledOnce()
    expect(deps.save).not.toHaveBeenCalled()
  })
})
