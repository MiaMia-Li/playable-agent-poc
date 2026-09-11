// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathname: '/',
  studioShellMounts: 0,
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  usePathname: () => mocks.pathname,
}))
vi.mock('@/lib/session/get-server-session', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/components/task-sidebar', () => ({ TaskSidebar: () => null }))
vi.mock('@/components/playable/studio-shell', async () => {
  const { useEffect } = await import('react')
  return {
    PlayableStudioShell: ({ children }: { children: React.ReactNode }) => {
      useEffect(() => {
        mocks.studioShellMounts += 1
      }, [])
      return <div aria-label="Playable Studio 工作台">{children}</div>
    },
  }
})

import TasksListPage from '@/app/tasks/page'
import TaskLoading from '@/app/tasks/[taskId]/loading'
import { AppLayout } from '@/components/app-layout'

afterEach(() => {
  cleanup()
  mocks.pathname = '/'
  mocks.studioShellMounts = 0
  vi.restoreAllMocks()
})

describe('playable page boundaries', () => {
  it('redirects /tasks to the playable home through Next navigation', async () => {
    await expect(TasksListPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/')
  })

  it('does not fetch connectors or poll the legacy task API on playable paths', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ connectors: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AppLayout initialSidebarOpen={false} initialIsMobile>
        <div>playable</div>
      </AppLayout>,
    )
    await waitFor(() => expect(screen.getByText('playable')).toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/connectors')).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/tasks')).toBe(false)
  })

  it('keeps the Playable Studio shell mounted while changing conversations in the current page', async () => {
    mocks.pathname = '/versions'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ tasks: [] })),
    )

    const view = render(
      <AppLayout initialSidebarOpen={false} initialIsMobile>
        <div>构建记录内容</div>
      </AppLayout>,
    )
    await waitFor(() => expect(screen.getByLabelText('Playable Studio 工作台')).toBeInTheDocument())
    expect(mocks.studioShellMounts).toBe(1)

    mocks.pathname = '/tasks/task-1'
    view.rerender(
      <AppLayout initialSidebarOpen={false} initialIsMobile>
        <div>对话内容</div>
      </AppLayout>,
    )

    expect(screen.getByText('对话内容')).toBeInTheDocument()
    expect(mocks.studioShellMounts).toBe(1)
  })

  it('shows a Playable Studio loading shell without legacy coding-agent actions', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ connectors: [] })),
    )

    render(
      <AppLayout initialSidebarOpen={false} initialIsMobile>
        <TaskLoading />
      </AppLayout>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在加载试玩…')
    expect(screen.queryByText('Deploy Your Own')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading task...')).not.toBeInTheDocument()
  })
})
