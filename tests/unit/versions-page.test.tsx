// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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
  it('loads build records once without embedded previews and links previews to a new tab', async () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: index === 0 ? '需求 1' : `试玩 ${index + 1}`,
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
            delivery: {
              label: 'AppLovin',
              logicalWidth: 360,
              logicalHeight: 640,
              output: 'single-html',
            },
            validation: {
              buildPassed: true,
              deliveryCompliant: true,
              bytes: 1048576,
            },
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

    const firstVersion = await screen.findByRole('row', { name: '构建 build-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/library', { cache: 'no-store' })
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(within(firstVersion).queryByText('需求 1')).not.toBeInTheDocument()
    expect(within(firstVersion).getByText('build-1')).toBeInTheDocument()
    expect(within(firstVersion).getByText('当前产物')).toBeInTheDocument()
    expect(within(firstVersion).getByText('1.0 MB')).toBeInTheDocument()
    expect(within(firstVersion).getByText('校验通过')).toBeInTheDocument()
    expect(within(firstVersion).getByRole('link', { name: '预览' })).toHaveAttribute(
      'href',
      '/api/playable-tasks/task-1/artifact?kind=playable&version=build-1',
    )
    expect(within(firstVersion).getByRole('link', { name: '预览' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
