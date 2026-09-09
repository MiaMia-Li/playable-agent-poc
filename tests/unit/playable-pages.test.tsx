// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  usePathname: () => '/',
}))
vi.mock('@/lib/session/get-server-session', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/components/task-sidebar', () => ({ TaskSidebar: () => null }))

import TasksListPage from '@/app/tasks/page'
import TaskLoading from '@/app/tasks/[taskId]/loading'
import { AppLayout } from '@/components/app-layout'

afterEach(() => {
  cleanup()
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

    expect(screen.getByRole('link', { name: '试玩工作台首页' })).toHaveTextContent('Playable Studio')
    expect(screen.getByRole('status')).toHaveTextContent('正在加载试玩…')
    expect(screen.queryByText('Deploy Your Own')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading task...')).not.toBeInTheDocument()
  })
})
