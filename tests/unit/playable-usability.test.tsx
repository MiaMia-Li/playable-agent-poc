// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatWorkspace } from '@/components/playable/chat-workspace'
import { BuildNotifications } from '@/components/playable/build-notifications'
import { watchPlayableBuild, BUILD_WATCH_KEY } from '@/lib/playable/build-notifications'
import { queueStorageKey } from '@/lib/playable/queued-requirements'

const { push, success, error } = vi.hoisted(() => ({ push: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success, error } }))

const props = { taskId: 'queue-task', onPhase: vi.fn(), onProposal: vi.fn() }
const reply = () => new Response(`${JSON.stringify({ type: 'informational', message: '已收到修改' })}\n`)
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('queued requirements', () => {
  it('edits and withdraws requirements during a build without sending them to the agent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatWorkspace {...props} phase="building" />)
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '标题改成夏日' } })
    fireEvent.click(screen.getByRole('button', { name: '加入排队需求' }))
    const queue = screen.getByRole('region', { name: '排队需求' })
    expect(await within(queue).findByText('标题改成夏日')).toBeInTheDocument()
    fireEvent.click(within(queue).getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('编辑排队需求'), { target: { value: '标题改成春日' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(sessionStorage.getItem(queueStorageKey(props.taskId))).toContain('标题改成春日')
    fireEvent.click(within(queue).getByRole('button', { name: '撤回' }))
    expect(sessionStorage.getItem(queueStorageKey(props.taskId))).toBe('[]')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores a queue on reload and sends each entry once after the build, preserving the composer draft', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => reply())
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<ChatWorkspace {...props} phase="building" />)
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '按钮大一点' } })
    fireEvent.click(screen.getByRole('button', { name: '加入排队需求' }))
    await screen.findByText('按钮大一点')
    first.unmount()
    // StrictMode 会额外触发 effect，用它验证队列恢复后不会重复发送同一条需求。
    const view = render(
      <StrictMode>
        <ChatWorkspace {...props} phase="building" />
      </StrictMode>,
    )
    expect(await screen.findByText('按钮大一点')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '还没写完的想法' } })
    view.rerender(
      <StrictMode>
        <ChatWorkspace {...props} phase="ready" />
      </StrictMode>,
    )
    await screen.findByText('已收到修改')
    await waitFor(() => expect(sessionStorage.getItem(queueStorageKey(props.taskId))).toBe('[]'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ message: '按钮大一点' })
    expect(screen.getByLabelText('试玩需求')).toHaveValue('还没写完的想法')
  })

  it('keeps failed sends for explicit retry without repeatedly calling the model', async () => {
    sessionStorage.setItem(
      queueStorageKey(props.taskId),
      JSON.stringify([{ id: 'q1', content: '放大按钮', baseBuildId: 'build-2', attachments: [], status: 'pending' }]),
    )
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('unavailable', { status: 503 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatWorkspace {...props} phase="ready" />)
    await screen.findByText(/发送未完成，请检查对话后重试/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockImplementation(async () => reply())
    fireEvent.click(screen.getByRole('button', { name: '重新发送' }))
    await screen.findByText('已收到修改')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).baseBuildId).toBe('build-2')
  })
})

describe('completion notifications', () => {
  it('waits for a build outcome and retains failure when the task has already moved to confirmation', async () => {
    vi.useFakeTimers()
    // 后续需求已把阶段推进到待确认时，仍需用最后的构建事件区分成功与失败。
    const events = [{ type: 'build_started' }]
    const fetchMock = vi.fn(async () => Response.json({ task: { phase: 'awaiting_revision_confirmation' }, events }))
    vi.stubGlobal('fetch', fetchMock)
    watchPlayableBuild('watched')
    render(<BuildNotifications />)
    await vi.advanceTimersByTimeAsync(1)
    expect(success).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(BUILD_WATCH_KEY)).toContain('watched')
    events.push({ type: 'build_failed' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(error).toHaveBeenCalledOnce()
    expect(success).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(BUILD_WATCH_KEY)).toBe('[]')
  })

  it('retains a watch across navigation and notifies once when the build completes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => Response.json({ task: { phase: 'ready' } }))
    vi.stubGlobal('fetch', fetchMock)
    watchPlayableBuild('watched')
    expect(sessionStorage.getItem(BUILD_WATCH_KEY)).toContain('watched')
    render(<BuildNotifications />)
    await vi.advanceTimersByTimeAsync(1)
    expect(success).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(BUILD_WATCH_KEY)).toBe('[]')
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledOnce()
    success.mock.calls[0][1].action.onClick()
    expect(push).toHaveBeenCalledWith('/tasks/watched')
  })
})
