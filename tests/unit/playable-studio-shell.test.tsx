// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { PlayableRecentTasksProvider } from '@/components/playable/recent-tasks-context'
import { PlayableStudioShell } from '@/components/playable/studio-shell'

let mockPathname = '/'

vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }))

afterEach(() => {
  cleanup()
  mockPathname = '/'
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlayableStudioShell recent conversations', () => {
  it('shows every loaded recent conversation', () => {
    const tasks = Array.from({ length: 13 }, (_, index) => ({
      id: `task-${index + 1}`,
      prompt: `试玩对话 ${index + 1}`,
      phase: 'draft' as const,
      createdAt: new Date().toISOString(),
    }))

    render(
      <PlayableStudioShell accountLabel="测试用户" tasks={tasks}>
        <div>首页</div>
      </PlayableStudioShell>,
    )

    expect(screen.getByRole('link', { name: /试玩对话 13/ })).toBeInTheDocument()
  })

  it('pins task workspaces to the viewport and locks root scrolling', () => {
    mockPathname = '/tasks/task-1'

    const { container } = render(
      <PlayableStudioShell accountLabel="测试用户" tasks={[]}>
        <div>任务工作台</div>
      </PlayableStudioShell>,
    )

    expect(container.querySelector('[data-playable-task-workspace="true"]')).toHaveClass('fixed', 'inset-0')
    expect(document.documentElement).toHaveClass('playable-task-scroll-lock')
    expect(document.body).toHaveClass('playable-task-scroll-lock')
  })

  it('keeps the recent conversation list while switching studio pages', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        tasks: [
          {
            id: 'task-1',
            prompt: '制作夏日海岛试玩',
            title: null,
            phase: 'draft',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    function StudioNavigationHarness() {
      const [section, setSection] = useState<'home' | 'best-practices'>('home')
      return (
        <PlayableRecentTasksProvider>
          <button type="button" onClick={() => setSection('best-practices')}>
            切换页面
          </button>
          <div key={section}>
            <PlayableStudioShell activeSection={section} accountLabel="测试用户">
              <div>{section}</div>
            </PlayableStudioShell>
          </div>
        </PlayableRecentTasksProvider>
      )
    }

    render(<StudioNavigationHarness />)
    const conversationLink = await screen.findByRole('link', { name: /进行中.*制作夏日海岛试玩/ })
    expect(conversationLink).not.toHaveAttribute('target')
    expect(conversationLink).not.toHaveAttribute('rel')

    fireEvent.click(screen.getByRole('button', { name: '切换页面' }))

    await waitFor(() => expect(screen.getByRole('link', { name: /进行中.*制作夏日海岛试玩/ })).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('collapses the desktop sidebar and hides recent conversations', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        tasks: [
          {
            id: 'task-1',
            prompt: '制作夏日海岛试玩',
            title: null,
            phase: 'draft',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlayableRecentTasksProvider>
        <PlayableStudioShell activeSection="home" accountLabel="测试用户">
          <div>首页</div>
        </PlayableStudioShell>
      </PlayableRecentTasksProvider>,
    )

    await screen.findByRole('link', { name: /制作夏日海岛试玩/ })
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))

    expect(screen.queryByText('最近对话')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /制作夏日海岛试玩/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem('playable-studio-sidebar-collapsed')).toBe('true')
  })

  it('renames a recent conversation from its overflow menu', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Response.json({ task: { id: 'task-1', title: '海岛寻宝挑战' } })
      }
      return Response.json({
        tasks: [
          {
            id: 'task-1',
            prompt: '制作夏日海岛试玩',
            title: null,
            phase: 'draft',
            createdAt: new Date().toISOString(),
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlayableRecentTasksProvider>
        <PlayableStudioShell activeSection="home" accountLabel="测试用户">
          <div>首页</div>
        </PlayableStudioShell>
      </PlayableRecentTasksProvider>,
    )
    await screen.findByRole('link', { name: /制作夏日海岛试玩/ })

    fireEvent.pointerDown(screen.getByRole('button', { name: '管理“制作夏日海岛试玩”' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }))
    fireEvent.change(screen.getByRole('textbox', { name: '对话名称' }), { target: { value: '海岛寻宝挑战' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('link', { name: /海岛寻宝挑战/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '海岛寻宝挑战' }),
    })
  })

  it('deletes a recent conversation after confirmation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return Response.json({
        tasks: [
          {
            id: 'task-1',
            prompt: '制作夏日海岛试玩',
            title: null,
            phase: 'draft',
            createdAt: new Date().toISOString(),
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlayableRecentTasksProvider>
        <PlayableStudioShell activeSection="home" accountLabel="测试用户">
          <div>首页</div>
        </PlayableStudioShell>
      </PlayableRecentTasksProvider>,
    )
    await screen.findByRole('link', { name: /制作夏日海岛试玩/ })

    fireEvent.pointerDown(screen.getByRole('button', { name: '管理“制作夏日海岛试玩”' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '删除对话' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /制作夏日海岛试玩/ })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-1', { method: 'DELETE' })
  })
})
