// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))

import { PlayableHome } from '@/components/playable/playable-workspace'
import { BestPracticesPage } from '@/components/playable/best-practices-page'

afterEach(() => {
  cleanup()
  mocks.push.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlayableHome reference uploads', () => {
  it('shows public access without a GitHub sign-in control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ tasks: [] })),
    )
    render(
      <PlayableHome
        user={{ id: 'public-playable-poc-user', username: 'playable-guest', email: undefined, avatar: '' }}
        authProvider="vercel"
        publicAccess
      />,
    )

    expect(screen.getByText('公开体验')).toBeInTheDocument()
    expect(screen.getByText('共享')).toBeInTheDocument()
    expect(screen.queryByText(/登录后/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('新试玩需求')).toBeEnabled()
    expect(screen.queryByText('最近生成')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '玩法模板' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '作品库' })).toBeInTheDocument()
  })

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

  it('starts a new conversation from a best-practice template', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/playable-tasks' && !init?.method) return Response.json({ tasks: [] })
      return Response.json({ task: { id: 'template-task' } }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableHome user={{ id: 'user-1', username: 'tester', email: undefined, avatar: '' }} authProvider="github" />,
    )

    fireEvent.click(screen.getByRole('button', { name: '预览中心碰撞模板' }))
    fireEvent.click(screen.getByRole('button', { name: '用此模板开始' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/tasks/template-task'))
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      prompt: expect.stringContaining('中心碰撞'),
    })
  })

  it('opens the real HTML template in an interactive preview', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ tasks: [] })),
    )
    render(
      <PlayableHome user={{ id: 'user-1', username: 'tester', email: undefined, avatar: '' }} authProvider="github" />,
    )

    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(screen.getAllByRole('img', { name: /模板封面/ })).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: '预览中心碰撞模板' }))

    const preview = screen.getByTitle('中心碰撞可交互预览')
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(preview).toHaveAttribute('src', '/playable-templates/center_collision.html')
    expect(preview).not.toHaveAttribute('tabindex', '-1')
    expect(
      screen.getByText('相同牌向中心碰撞、破碎并计分。可直接在下方试玩，确认后从这个模板继续创作。'),
    ).toBeInTheDocument()
  })

  it('loads a best-practice HTML only after its cover is opened', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ tasks: [] })),
    )
    render(<BestPracticesPage accountLabel="测试用户" />)

    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(screen.getAllByRole('img', { name: /模板封面/ })).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: '预览上方牌架模板' }))

    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(screen.getByTitle('上方牌架可交互预览')).toHaveAttribute('src', '/playable-templates/top_rack.html')
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
          new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
        ],
      },
    })

    expect(screen.getByText('单个参考素材不能超过 4 MiB')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '已选择的参考素材' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建试玩' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('reuses the created task and skips successful uploads on an unchanged retry', async () => {
    let failedOnce = false
    let taskCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/playable-tasks' && !init?.method) return Response.json({ tasks: [] })
      if (url === '/api/playable-tasks' && init?.method === 'POST') {
        taskCount += 1
        return Response.json({ task: { id: `task-${taskCount}` } }, { status: 201 })
      }
      const filename = ((init?.body as FormData).get('file') as File).name
      if (filename === 'retry.png' && !failedOnce) {
        failedOnce = true
        return new Response(null, { status: 500 })
      }
      return Response.json({ asset: { id: filename } }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableHome user={{ id: 'user-1', username: 'tester', email: undefined, avatar: '' }} authProvider="github" />,
    )

    fireEvent.change(screen.getByLabelText('新试玩需求'), { target: { value: '原样重试' } })
    fireEvent.change(screen.getByLabelText('上传参考图片或视频'), {
      target: {
        files: [
          new File(['ok'], 'success.png', { type: 'image/png' }),
          new File(['retry'], 'retry.png', { type: 'image/png' }),
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '新建试玩' }))
    expect(await screen.findByText('参考素材上传失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建试玩' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/tasks/task-1'))
    expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/playable-tasks' && init?.method),
    ).toHaveLength(1)
    const uploads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assets'))
    expect(uploads.map(([, init]) => ((init?.body as FormData).get('file') as File).name)).toEqual([
      'success.png',
      'retry.png',
      'retry.png',
    ])
  })

  it('does not reuse a failed task after the prompt changes', async () => {
    let taskCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/playable-tasks' && !init?.method) return Response.json({ tasks: [] })
      if (String(input) === '/api/playable-tasks') {
        taskCount += 1
        return Response.json({ task: { id: `task-${taskCount}` } }, { status: 201 })
      }
      return new Response(null, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableHome user={{ id: 'user-1', username: 'tester', email: undefined, avatar: '' }} authProvider="github" />,
    )

    fireEvent.change(screen.getByLabelText('新试玩需求'), { target: { value: '第一版' } })
    fireEvent.change(screen.getByLabelText('上传参考图片或视频'), {
      target: { files: [new File(['x'], 'reference.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: '新建试玩' }))
    expect(await screen.findByText('参考素材上传失败')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('新试玩需求'), { target: { value: '第二版' } })
    fireEvent.click(screen.getByRole('button', { name: '新建试玩' }))
    await waitFor(() => expect(taskCount).toBe(2))
  })
})
