import { afterEach, expect, it, vi } from 'vitest'
import { withPreviewBudget } from '@/lib/playable/preview-build'

afterEach(() => vi.useRealTimers())

it('notifies on the target without aborting or restarting the current work', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  let signal!: AbortSignal
  const execute = vi.fn((value: AbortSignal) => {
    signal = value
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  const notify = vi.fn()
  const work = withPreviewBudget(execute, { targetMs: 100, onTargetExceeded: notify })
  await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
  expect(notify).toHaveBeenCalledOnce()
  expect(signal.aborted).toBe(false)
  expect(execute).toHaveBeenCalledOnce()
  finish()
  await work
  expect(vi.getTimerCount()).toBe(0)
})

it('still respects user cancellation and clears timers', async () => {
  vi.useFakeTimers()
  const user = new AbortController()
  const work = withPreviewBudget(
    (signal) =>
      new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    { signal: user.signal, targetMs: 100, onTargetExceeded: vi.fn() },
  )
  const assertion = expect(work).rejects.toMatchObject({ name: 'AbortError' })
  user.abort()
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

it('continues even if preparation has consumed the target time', async () => {
  const execute = vi.fn(async (signal: AbortSignal) => {
    expect(signal.aborted).toBe(false)
    return 'done'
  })
  expect(await withPreviewBudget(execute, { targetMs: -100, onTargetExceeded: vi.fn() })).toBe('done')
})
