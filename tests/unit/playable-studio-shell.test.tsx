// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { PlayableRecentTasksProvider } from '@/components/playable/recent-tasks-context'
import { PlayableStudioShell } from '@/components/playable/studio-shell'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlayableStudioShell recent conversations', () => {
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
    expect(conversationLink).toHaveAttribute('target', '_blank')
    expect(conversationLink).toHaveAttribute('rel', 'noopener noreferrer')

    fireEvent.click(screen.getByRole('button', { name: '切换页面' }))

    await waitFor(() => expect(screen.getByRole('link', { name: /进行中.*制作夏日海岛试玩/ })).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
