import { expect, it } from 'vitest'
import { placeBuildRuns } from '@/lib/playable/build-conversation'

it('历史构建和重试跟随原方案，新构建跟随修改方案，缺少时间不猜测归属', () => {
  const messages = [
    { id: 'first', role: 'assistant', confirmation: {}, createdAt: '2026-09-14T01:00:00Z' },
    { id: 'second', role: 'assistant', confirmation: {}, createdAt: '2026-09-14T02:00:00Z' },
  ]
  const result = placeBuildRuns(messages, [
    { id: 'a', type: 'build_started', createdAt: '2026-09-14T01:01:00Z' },
    { id: 'b', type: 'build_started', createdAt: '2026-09-14T01:20:00Z' },
    { id: 'c', type: 'build_started', createdAt: '2026-09-14T02:01:00Z' },
    { id: 'd', type: 'build_started' },
  ])
  expect(result.map((run) => run.ownerId)).toEqual(['first', 'first', 'second', undefined])
  expect(result.map((run) => run.latest)).toEqual([false, false, false, true])
})
