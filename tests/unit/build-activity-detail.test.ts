import { describe, expect, it, vi } from 'vitest'
import {
  createHarnessActivityReporter,
  readBuildActivityDetail,
  reportCliBuildActivity,
  sanitizeBuildActivityDetail,
} from '@/lib/playable/build-activity-detail'

describe('公开构建事件', () => {
  it('将 CLI 和 Harness 的重连、回退、异常通知显示为固定状态，不暴露提供方载荷', () => {
    const report = vi.fn()
    const stream = createHarnessActivityReporter(report)
    const notices = [
      ['Reconnecting... 1/5 (private sk-private-token)', 'agent_reconnecting'],
      ['Reconnecting... waiting for network', 'agent_reconnecting'],
      ['Falling back from WebSockets to HTTPS transport. private', 'agent_transport_fallback'],
      ['Previous response was not found. Retrying the full request.', 'agent_retrying'],
      ['Selected model is at capacity. Please try a different model.', 'agent_warning'],
    ]
    for (const [message, activity] of notices) {
      reportCliBuildActivity({ type: 'error', message }, report)
      stream.accept({ type: 'raw', rawValue: { type: 'codex.error', message } })
      expect(report.mock.calls.slice(-2)).toEqual([[activity], [activity]])
    }
    expect(JSON.stringify(report.mock.calls)).not.toContain('private')
  })

  it('重连通知不会截断仍在接收的文本，避免跨片段脱敏失效', () => {
    const report = vi.fn()
    const stream = createHarnessActivityReporter(report)
    // 故意把同一密钥拆到重连前后，完整段落保存后才能进行精确替换。
    stream.accept({ type: 'text-delta', id: 't1', text: 'sk-pri' })
    stream.accept({ type: 'raw', rawValue: { type: 'codex.error', message: 'Reconnecting... 1/5' } })
    expect(report.mock.calls).toEqual([['agent_reconnecting']])
    stream.accept({ type: 'text-delta', id: 't1', text: 'vate-token' })
    stream.accept({ type: 'text-end', id: 't1' })
    expect(sanitizeBuildActivityDetail(report.mock.calls[1][1], ['sk-private-token']).text).toBe('[已隐藏]')
  })

  it('隐藏 CLI 和分段 Harness 的内部完成协议，保留正常说明', () => {
    const report = vi.fn()
    reportCliBuildActivity(
      { type: 'item.completed', item: { type: 'agent_message', text: '{"completed":true}' } },
      report,
    )
    const stream = createHarnessActivityReporter(report)
    stream.accept({ type: 'text-delta', id: 'completion', text: '{"completed":' })
    stream.accept({ type: 'text-delta', id: 'completion', text: 'true}' })
    stream.accept({ type: 'text-end', id: 'completion' })
    stream.flush()
    expect(report).not.toHaveBeenCalled()
    reportCliBuildActivity(
      { type: 'item.completed', item: { type: 'agent_message', text: '检查完成，等待发布' } },
      report,
    )
    expect(report).toHaveBeenCalledExactlyOnceWith('agent_message', { text: '检查完成，等待发布' })
  })

  it('按段保存公开摘要，工具调用立即报告，未知原始载荷不报告', () => {
    const report = vi.fn()
    const stream = createHarnessActivityReporter(report)
    stream.accept({ type: 'reasoning-delta', id: 'r1', text: '先读取' })
    stream.accept({ type: 'reasoning-delta', id: 'r1', text: '模板。' })
    expect(report).not.toHaveBeenCalled()
    stream.accept({ type: 'reasoning-end', id: 'r1' })
    expect(report).toHaveBeenLastCalledWith('reasoning_summary', { id: 'r1', text: '先读取模板。' })
    stream.accept({ type: 'tool-call', toolCallId: 'c1', toolName: 'bash', input: { command: 'pwd' } })
    expect(report).toHaveBeenLastCalledWith(
      'command_started',
      expect.objectContaining({ tool: 'bash', input: expect.stringContaining('pwd') }),
    )
    stream.accept({
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'bash',
      output: { exitCode: 1, output: 'failed' },
    })
    expect(report).toHaveBeenLastCalledWith(
      'command_failed',
      expect.objectContaining({ output: expect.stringContaining('failed') }),
    )
    stream.accept({ type: 'raw', rawValue: { hidden_reasoning: 'private' } })
    stream.flush()
    expect(report).toHaveBeenCalledTimes(3)
  })

  it('流中断后保留已收到文本，兼容 delta 字段且不会重复输出', () => {
    const report = vi.fn()
    const stream = createHarnessActivityReporter(report)
    stream.accept({ type: 'text-delta', id: 't1', delta: '正在检查游戏' })
    stream.flush()
    stream.flush()
    expect(report).toHaveBeenCalledExactlyOnceWith('agent_message', { id: 't1', text: '正在检查游戏' })
  })

  it('展示 CLI 的说明、摘要及工具参数与结果', () => {
    const report = vi.fn()
    reportCliBuildActivity({ type: 'item.completed', item: { type: 'reasoning', id: '1', text: '检查布局' } }, report)
    reportCliBuildActivity(
      {
        type: 'item.completed',
        item: { type: 'command_execution', command: 'ls', aggregated_output: 'index.html', exit_code: 0 },
      },
      report,
    )
    expect(report).toHaveBeenCalledWith('reasoning_summary', { id: '1', text: '检查布局' })
    expect(report).toHaveBeenCalledWith(
      'command_completed',
      expect.objectContaining({ input: 'ls', output: 'index.html' }),
    )
  })

  it('在截断前彻底移除已知密钥、JSON 密钥、认证头和连接串', () => {
    const value = sanitizeBuildActivityDetail(
      {
        input: JSON.stringify({
          command: 'TOKEN=privatevalue',
          api_key: 'unknownvalue',
          authorization: 'Bearer anothersecret',
        }),
        output: 'custom-secret sk-unknownkey postgres://user:password@db.example/db ' + 'x'.repeat(25000),
      },
      ['custom-secret', 'privatevalue'],
    )
    const serialized = JSON.stringify(value)
    for (const secret of [
      'custom-secret',
      'privatevalue',
      'unknownvalue',
      'anothersecret',
      'sk-unknownkey',
      'user:password',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(value.output).toContain('已截断')
    expect(readBuildActivityDetail(JSON.stringify({ version: 1, detail: value }))).toEqual(value)
    expect(readBuildActivityDetail('raw secret')).toBeUndefined()
    expect(readBuildActivityDetail('{invalid')).toBeUndefined()
  })
})
