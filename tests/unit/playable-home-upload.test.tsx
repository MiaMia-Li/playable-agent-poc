// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))

import { PlayableHome } from '@/components/playable/playable-workspace'

afterEach(() => {
  cleanup()
  mocks.push.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlayableHome reference uploads', () => {
  it('uploads selected image and video references before opening the new task', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/playable-tasks' && !init?.method) return Response.json({ tasks: [] })
      if (url === '/api/playable-tasks' && init?.method === 'POST') {
        return Response.json({ task: { id: 'task-home' } }, { status: 201 })
      }
      return Response.json({ asset: { id: 'asset' } }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableHome
        user={{ id: 'user-1', username: 'tester', email: 'tester@example.com', avatar: '' }}
        authProvider="github"
      />,
    )

    const image = new File(['image'], 'style.png', { type: 'image/png' })
    const video = new File(['video'], 'motion.webm', { type: 'video/webm' })
    fireEvent.change(screen.getByLabelText('上传参考图片或视频'), { target: { files: [image, video] } })

    expect(screen.getByRole('list', { name: '已选择的参考素材' })).toHaveTextContent('style.png')
    expect(screen.getByRole('list', { name: '已选择的参考素材' })).toHaveTextContent('motion.webm')
    expect(screen.getByRole('button', { name: '新建试玩' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '新建试玩' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/tasks/task-home'))
    const uploadCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assets'))
    expect(uploadCalls).toHaveLength(2)
    expect((uploadCalls[0][1]?.body as FormData).get('slot')).toBe('referenceImage')
    expect((uploadCalls[1][1]?.body as FormData).get('slot')).toBe('referenceVideo')
    expect(fetchMock.mock.invocationCallOrder[1]).toBeLessThan(fetchMock.mock.invocationCallOrder[2])
    expect(fetchMock.mock.invocationCallOrder[2]).toBeLessThan(mocks.push.mock.invocationCallOrder[0])
  })

  it('rejects unsupported and oversized references before creating a task', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ tasks: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableHome user={{ id: 'user-1', username: 'tester', email: undefined, avatar: '' }} authProvider="github" />,
    )

    fireEvent.change(screen.getByLabelText('上传参考图片或视频'), {
      target: {
        files: [
          new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' }),
          new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.mp4', { type: 'video/mp4' }),
        ],
      },
    })

    expect(screen.getByText('单个参考素材不能超过 4 MiB')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '已选择的参考素材' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建试玩' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
})
