// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/versions',
}))

import { VersionsPage } from '@/components/playable/versions-page'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('versions page loading', () => {
  it('loads library metadata in one request and defers playable previews', async () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `试玩 ${index + 1}`,
      prompt: `需求 ${index + 1}`,
      phase: 'ready' as const,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      hasArtifact: true,
    }))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/playable-tasks/library') {
        return Response.json({
          tasks,
          versions: tasks.map((task, index) => ({
            id: `build-${index + 1}`,
            taskId: task.id,
            status: 'succeeded',
            version: 1,
            current: true,
            createdAt: '2026-09-10T00:00:00.000Z',
            completedAt: '2026-09-10T00:01:00.000Z',
          })),
        })
      }
      if (url === '/api/playable-tasks') return Response.json({ tasks })
      const taskId = url.match(/^\/api\/playable-tasks\/(task-\d+)\/versions$/)?.[1]
      if (taskId) {
        const index = Number(taskId.split('-')[1])
        return Response.json({
          builds: [
            {
              id: `build-${index}`,
              status: 'succeeded',
              version: 1,
              current: true,
              createdAt: '2026-09-10T00:00:00.000Z',
              completedAt: '2026-09-10T00:01:00.000Z',
            },
          ],
        })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<VersionsPage accountLabel="测试账号" />)

    await waitFor(() => expect(screen.getAllByTitle(/缩略预览$/)).toHaveLength(3))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/library', { cache: 'no-store' })
    for (const preview of screen.getAllByTitle(/缩略预览$/)) {
      expect(preview).toHaveAttribute('loading', 'lazy')
    }
  })
})
