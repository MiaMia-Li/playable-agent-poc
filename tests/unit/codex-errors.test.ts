import { describe, expect, it } from 'vitest'
import { classifyCodexFailure, codexNoticeActivity } from '@/lib/playable/codex-errors'

describe('Codex failure classification', () => {
  // 同时覆盖裸错误与包在重连文案里的根因，确保外层 transport 描述不改变错误类别。
  it.each([
    ['Selected model is at capacity. Please try a different model.', 'capacity'],
    ['Reconnecting... 1/5 (stream disconnected before completion: Our servers are currently overloaded.)', 'capacity'],
    ['server is overloaded', 'capacity'],
    [
      'Reconnecting... 1/5 (stream disconnected before completion: stream closed before response.completed)',
      'connection',
    ],
    ['Codex stream closed before turn.completed', 'connection'],
    ['codex bridge closed before the turn finished.', 'connection'],
    ['stream idle timeout', 'connection'],
    ['unexpected status 502 Bad Gateway', 'connection'],
    ['rate_limit_exceeded', 'rate_limit'],
    ['too many requests', 'rate_limit'],
    ['Reconnecting... 1/5 (stream disconnected before completion: You have no credits remaining.)', 'quota'],
    ['Selected model is at capacity: insufficient_quota', 'quota'],
    ['stream disconnected before completion: invalid_api_key', 'auth'],
    ['stream disconnected before completion: context_length_exceeded', 'other'],
    ['stream disconnected before completion: model_not_found', 'other'],
    ['stream disconnected before completion: unexpected status 403', 'auth'],
    ['stream disconnected before completion: unexpected status 400 Bad Request', 'other'],
    ['stream disconnected before completion: unexpected status 429', 'rate_limit'],
    ['command execution failed', 'other'],
  ])('classifies %s as %s', (message, kind) => {
    expect(classifyCodexFailure(new Error('Build failed', { cause: { message } }))).toBe(kind)
  })

  it('reads nested SDK statuses and gives permanent failures precedence', () => {
    expect(classifyCodexFailure({ lastError: { response: { status: 503 } } })).toBe('capacity')
    expect(classifyCodexFailure({ error: { code: 'rate_limit_exceeded' } })).toBe('rate_limit')
    expect(classifyCodexFailure({ message: 'model is at capacity', cause: { statusCode: 401 } })).toBe('auth')
    expect(classifyCodexFailure({ message: 'stream disconnected before completion', status: 400 })).toBe('other')
    expect(
      classifyCodexFailure(new Error('network error', { cause: new DOMException('deadline', 'TimeoutError') })),
    ).toBe('cancelled')
    // 提供方的错误对象可能自引用，分类必须能够终止。
    const cyclic = { message: 'network error', cause: {} }
    cyclic.cause = cyclic
    expect(classifyCodexFailure(cyclic)).toBe('connection')
  })

  // 最后一次重连通知仍不是最终失败；具体成败必须等待执行器的终态。
  it.each([
    ['Reconnecting... 5/5 (stream closed before response.completed)', 'agent_reconnecting'],
    ['Reconnecting... waiting for network', 'agent_reconnecting'],
    ['Previous response was not found. Retrying the full request.', 'agent_retrying'],
    ['Falling back from WebSockets to HTTPS transport. private detail', 'agent_transport_fallback'],
    ['Selected model is at capacity. Please try a different model.', 'agent_warning'],
  ])('reports an in-flight notice separately: %s', (message, activity) => {
    expect(codexNoticeActivity(message)).toBe(activity)
  })
})
