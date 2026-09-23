import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { createCodex } from '@ai-sdk/harness-codex'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createHarnessActivityReporter } from '@/lib/playable/build-activity-detail'

type Event = Record<string, unknown>
type Turn = {
  abortSignal: AbortSignal
  emit: (event: Event) => void
  emitError: (input: { error: unknown }) => void
  emitWarning: () => void
}

let bridgeCode: string
beforeAll(async () => {
  const bootstrap = await createCodex().getBootstrap!()
  const bridge = bootstrap.files.find((file) => file.path.endsWith('/bridge.mjs'))
  expect(typeof bridge?.content).toBe('string')
  const code = bridge!.content as string
  // 直接执行实际传入 Sandbox 的 bootstrap 代码，防止只改包内 TS 源码却漏改运行产物。
  // 截取事件转换和执行循环，排除服务启动及工具转发设施；升级依赖时需复核这些边界。
  const trackerStart = code.indexOf('// src/bridge/codex-step-tracker.ts')
  const trackerEnd = code.indexOf('// src/bridge/tool-relay.ts', trackerStart)
  const turnStart = code.indexOf('async function runTurn(')
  const turnEnd = code.indexOf('async function startToolRelay(', turnStart)
  expect(trackerStart).toBeGreaterThan(0)
  expect(trackerEnd).toBeGreaterThan(trackerStart)
  expect(turnEnd).toBeGreaterThan(turnStart)
  bridgeCode = code.slice(trackerStart, trackerEnd).replace(/^import .*;$/gm, '') + code.slice(turnStart, turnEnd)
})

async function runBridge(events: Event[], options: { abortSignal?: AbortSignal; failure?: Error } = {}) {
  const output: Event[] = []
  // 只替换 SDK 的事件来源，不连接真实模型；事件消费及终态判断使用已安装的补丁代码。
  const sdk = {
    async runStreamed() {
      return {
        events: (async function* () {
          yield* events
          if (options.failure) throw options.failure
        })(),
      }
    },
  }
  const run = runInNewContext(bridgeCode + '\nrunTurn', {
    randomUUID2: randomUUID,
    procEnv2: {},
    threadState: {},
    workdir: '/test',
    codexSdk: {
      Codex: class {
        startThread() {
          return sdk
        }
      },
    },
  }) as (start: Event, turn: Turn) => Promise<void>
  await run(
    { prompt: 'Build the confirmed playable' },
    {
      abortSignal: options.abortSignal ?? new AbortController().signal,
      emit: (event) => output.push(event),
      emitError: ({ error }) => output.push({ type: 'error', error }),
      emitWarning: () => undefined,
    },
  )
  return output
}

describe('installed Codex bridge retry protocol', () => {
  it('keeps all reconnect attempts alive and finishes only after native completion', async () => {
    // 走完 1/5 到 5/5 后再成功，才能发现适配器在第一条通知就中断订阅的问题。
    const messages = Array.from(
      { length: 5 },
      (_, i) => `Reconnecting... ${i + 1}/5 (stream closed before response.completed)`,
    )
    const output = await runBridge([
      ...messages.map((message) => ({ type: 'error', message })),
      { type: 'item.completed', item: { type: 'agent_message', id: 'answer', text: 'Done' } },
      { type: 'turn.completed' },
    ])
    expect(output.filter((event) => event.type === 'error')).toEqual([])
    expect(output.filter((event) => event.type === 'raw')).toHaveLength(5)
    expect(output.at(-1)).toMatchObject({ type: 'finish', finishReason: { unified: 'stop' } })
    const report = vi.fn()
    const progress = createHarnessActivityReporter(report)
    output.forEach(progress.accept)
    expect(report.mock.calls.filter(([activity]) => activity === 'agent_reconnecting')).toHaveLength(5)
  })

  it.each([
    'Selected model is at capacity. Please try a different model.',
    'stream disconnected before completion: rate limit exceeded',
    'stream disconnected before completion: You have no credits remaining.',
    'unknown fatal failure',
  ])('keeps the final failure authoritative: %s', async (message) => {
    // 同一文案可以先作为中途通知、后作为最终错误出现，必须按事件类型区分。
    const output = await runBridge([
      { type: 'error', message },
      { type: 'turn.failed', error: { message } },
    ])
    expect(output.at(-1)).toEqual({ type: 'error', error: message })
    expect(output.some((event) => event.type === 'finish')).toBe(false)
  })

  it.each([
    { events: [], message: 'Codex stream closed before turn.completed' },
    {
      events: [{ type: 'error', message: 'Reconnecting... 1/5 (stream closed before response.completed)' }],
      message: 'Reconnecting... 1/5 (stream closed before response.completed)',
    },
  ])('never treats an incomplete stream as successful', async ({ events, message }) => {
    const output = await runBridge(events)
    expect(output.at(-1)?.type).toBe('error')
    expect(output.at(-1)?.error).toMatchObject({ message })
    expect(output.some((event) => event.type === 'finish')).toBe(false)
  })

  it('preserves transport exceptions and cancellation', async () => {
    const failure = new Error('transport failed')
    expect((await runBridge([], { failure })).at(-1)).toEqual({ type: 'error', error: failure })
    const abortSignal = AbortSignal.abort(new DOMException('cancelled', 'AbortError'))
    expect((await runBridge([{ type: 'turn.completed' }], { abortSignal })).at(-1)).toEqual({
      type: 'error',
      error: abortSignal.reason,
    })
  })
})
