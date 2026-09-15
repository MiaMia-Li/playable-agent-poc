// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BuildTimeline } from '@/components/playable/build-timeline'

afterEach(cleanup)
it('运行时持续计时，结束后保留累计阶段耗时且不虚构浏览器验收', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
  const at = Date.now()
  const events = [
    { id: 'start', type: 'build_started', createdAt: new Date(at).toISOString() },
    {
      id: 'model',
      type: 'build_activity_stage_started',
      message: JSON.stringify({ version: 1, detail: { timing: { stage: 'model', at } } }),
    },
  ]
  try {
    const view = render(<BuildTimeline running events={events} />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByRole('status')).toHaveTextContent('正在构建 3 秒 · 模型修改')
    expect(screen.getByLabelText('构建阶段耗时')).toHaveTextContent('0分3秒 · 进行中')
    view.rerender(
      <BuildTimeline
        running={false}
        events={[
          ...events,
          {
            id: 'model-end',
            type: 'build_activity_stage_completed',
            message: JSON.stringify({
              version: 1,
              detail: { timing: { stage: 'model', at: at + 3000, durationMs: 3000 } },
            }),
          },
          { id: 'end', type: 'build_succeeded', createdAt: new Date(at + 3000).toISOString() },
        ]}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByLabelText('构建阶段耗时')).toHaveTextContent('浏览器验收未记录')
    expect(screen.getByRole('status')).toHaveTextContent('已工作 3 秒')
    view.unmount()
  } finally {
    vi.useRealTimers()
  }
})
it('历史完成协议不展示，只有应用发布成功才提示可以体验', () => {
  const events = [
    { id: 'start', type: 'build_started' },
    {
      id: 'json',
      type: 'build_activity_agent_message',
      message: JSON.stringify({ version: 1, detail: { text: '```json\n{"completed":true}\n```' } }),
    },
    { id: 'agent-end', type: 'build_activity_agent_completed' },
  ]
  const view = render(<BuildTimeline events={events} running />)
  expect(screen.queryByText(/completed/)).not.toBeInTheDocument()
  expect(screen.queryByText(/试玩已生成/)).not.toBeInTheDocument()
  view.rerender(<BuildTimeline events={[...events, { id: 'fail', type: 'build_failed' }]} running={false} />)
  expect(screen.queryByText(/试玩已生成/)).not.toBeInTheDocument()
  view.rerender(<BuildTimeline events={[...events, { id: 'done', type: 'build_succeeded' }]} running={false} />)
  expect(screen.getByText(/试玩已生成，可以开始体验/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /已工作/ }))
  expect(screen.queryByText(/completed/)).not.toBeInTheDocument()
})

it('保留历史构建，展开最新记录时不混入旧步骤', () => {
  render(
    <BuildTimeline
      running={false}
      events={[
        { id: '1', type: 'build_started' },
        { id: '2', type: 'build_failed' },
        { id: '3', type: 'build_started' },
        { id: '4', type: 'build_activity_file_changed' },
        { id: '5', type: 'build_activity_command_failed' },
        { id: '6', type: 'build_succeeded' },
        { id: '7', type: 'secret' },
      ]}
    />,
  )
  fireEvent.click(screen.getAllByRole('button', { name: /已工作/ }).at(-1)!)
  expect(screen.getByText('已更新工作区文件')).toBeInTheDocument()
  expect(screen.getByText('命令执行失败，等待 Agent 处理')).toBeInTheDocument()
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('构建失败')
  expect(screen.queryByText('secret')).not.toBeInTheDocument()
  expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('构建完成')
})

it('构建时默认展开公开摘要和工具详情，输出按纯文本呈现', () => {
  render(
    <BuildTimeline
      running
      events={[
        { id: '1', type: 'build_started' },
        {
          id: '2',
          type: 'build_activity_reasoning_summary',
          message: JSON.stringify({ version: 1, detail: { text: '先复用现有模板' } }),
        },
        {
          id: '3',
          type: 'build_activity_command_completed',
          message: JSON.stringify({
            version: 1,
            detail: { tool: 'bash', input: 'cat index.html', output: '<script>alert(1)</script>' },
          }),
        },
      ]}
    />,
  )
  fireEvent.click(screen.getByText('Thinking', { selector: 'summary' }))
  expect(screen.getByText('先复用现有模板')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '命令已完成 · bash' }))
  expect(screen.getByText('cat index.html')).toBeVisible()
  expect(screen.getByText('<script>alert(1)</script>')).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
})

it('合并调用并保留参数与结果，结束后收起为耗时摘要', () => {
  const events = [
    { id: 'start', type: 'build_started', createdAt: '2026-09-14T04:00:00Z' },
    {
      id: 'call',
      type: 'build_activity_command_started',
      message: JSON.stringify({ version: 1, detail: { id: 'tool-1', tool: 'bash', input: 'pwd' } }),
    },
    {
      id: 'result',
      type: 'build_activity_command_completed',
      message: JSON.stringify({ version: 1, detail: { id: 'tool-1', tool: 'bash', output: '/workspace' } }),
    },
  ]
  const view = render(<BuildTimeline running events={events} />)
  expect(screen.queryByText('正在执行命令')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '命令已完成 · bash' }))
  expect(screen.getByText('pwd')).toBeVisible()
  expect(screen.getByText('/workspace')).toBeVisible()
  view.rerender(
    <BuildTimeline
      running={false}
      events={[...events, { id: 'end', type: 'build_succeeded', createdAt: '2026-09-14T04:02:38Z' }]}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('已工作 2 分 38 秒 · 构建完成')
  expect(screen.queryByText('pwd')).not.toBeInTheDocument()
})

it('失败后可展开预览验收诊断', () => {
  render(
    <BuildTimeline
      running={false}
      events={[
        { id: 'start', type: 'build_started' },
        {
          id: 'diagnostic',
          type: 'build_activity_preview_check_failed',
          message: JSON.stringify({
            version: 1,
            detail: { output: '{"failureStage":"browser_errors","errors":["Ad platform unavailable"]}' },
          }),
        },
        { id: 'failed', type: 'build_failed' },
      ]}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /已工作/ }))
  fireEvent.click(screen.getByRole('button', { name: '预览交互检查失败' }))
  expect(screen.getByText(/Ad platform unavailable/)).toBeVisible()
  expect(screen.queryByText(/试玩已生成/)).not.toBeInTheDocument()
})
