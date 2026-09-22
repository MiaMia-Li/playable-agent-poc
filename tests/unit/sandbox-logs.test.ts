import { describe, expect, it, vi } from 'vitest'
import { downloadTaskSandboxLogs, type SandboxLogsDependencies } from '../../scripts/sandbox-logs'

function dependencies(): SandboxLogsDependencies {
  return {
    findTaskBuilds: vi.fn().mockResolvedValue({
      userId: 'owner',
      taskId: 'task-123',
      failedBuildId: 'failed-build',
      latestBuildStatus: 'failed',
    }),
    download: vi.fn().mockResolvedValue('{"version":1}'),
    save: vi.fn().mockResolvedValue(undefined),
  }
}

describe('sandbox:logs task lookup', () => {
  it('downloads the selected failed build using the owner from the database', async () => {
    const deps = dependencies()
    await downloadTaskSandboxLogs(['task-123'], deps)
    expect(deps.findTaskBuilds).toHaveBeenCalledWith('task-123')
    expect(deps.download).toHaveBeenCalledWith('users/owner/tasks/task-123/failed-build/sandbox-diagnostics.json')
    expect(deps.save).toHaveBeenCalledWith('task-123', '{"version":1}')
  })

  it.each([[], ['../escape'], ['task', 'extra']])(
    'rejects invalid arguments before accessing services: %j',
    async (...args) => {
      const deps = dependencies()
      await expect(downloadTaskSandboxLogs(args, deps)).rejects.toThrow('Usage:')
      expect(deps.findTaskBuilds).not.toHaveBeenCalled()
    },
  )

  it('explains a missing task without accessing Blob or replacing local logs', async () => {
    const deps = dependencies()
    vi.mocked(deps.findTaskBuilds).mockResolvedValue(undefined)
    await expect(downloadTaskSandboxLogs(['task-123'], deps)).rejects.toThrow(
      'Task not found in the configured database',
    )
    expect(deps.download).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it.each([
    { latestBuildStatus: 'succeeded' as const, message: 'its latest build succeeded' },
    { latestBuildStatus: 'building' as const, message: 'its latest build is still marked as building' },
    { latestBuildStatus: null, message: 'This task has no builds yet' },
  ])('explains an existing task with no failed builds: $latestBuildStatus', async ({ latestBuildStatus, message }) => {
    const deps = dependencies()
    vi.mocked(deps.findTaskBuilds).mockResolvedValue({
      userId: 'owner',
      taskId: 'task-123',
      failedBuildId: null,
      latestBuildStatus,
    })
    await expect(downloadTaskSandboxLogs(['task-123'], deps)).rejects.toThrow(message)
    expect(deps.download).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it.each(['succeeded', 'building'] as const)(
    'still downloads the latest failed build when a newer build is %s',
    async (latestBuildStatus) => {
      const deps = dependencies()
      vi.mocked(deps.findTaskBuilds).mockResolvedValue({
        userId: 'owner',
        taskId: 'task-123',
        failedBuildId: 'failed-build',
        latestBuildStatus,
      })
      await downloadTaskSandboxLogs(['task-123'], deps)
      expect(deps.download).toHaveBeenCalledWith('users/owner/tasks/task-123/failed-build/sandbox-diagnostics.json')
      expect(deps.save).toHaveBeenCalledWith('task-123', '{"version":1}')
    },
  )

  it('reports missing diagnostics without replacing local logs or falling back', async () => {
    const deps = dependencies()
    vi.mocked(deps.download).mockResolvedValue(undefined)
    await expect(downloadTaskSandboxLogs(['task-123'], deps)).rejects.toThrow('latest failed build has no diagnostics')
    expect(deps.download).toHaveBeenCalledOnce()
    expect(deps.save).not.toHaveBeenCalled()
  })
})
