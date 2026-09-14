import { expect, it, vi } from 'vitest'
import { createBuildTimingReporter, readBuildTiming } from '@/lib/playable/build-timing'
import { sanitizeBuildActivityDetail, readBuildActivityDetail } from '@/lib/playable/build-activity-detail'

it('records exclusive model/browser intervals and accumulates retries without counting browser time twice', () => {
  let now = 0
  const report = vi.fn()
  const timing = createBuildTimingReporter(report, () => now)
  timing.activity('preparing')
  now = 10
  timing.activity('transferring')
  now = 30
  timing.activity('agent_started')
  now = 60
  timing.activity('command_started', {
    id: 'qa',
    input: 'node assets/starter/work/browser-acceptance.mjs output.html work/scenario.mjs',
  })
  now = 160
  timing.activity('command_failed', { id: 'qa' })
  now = 170
  timing.activity('agent_completed')
  now = 180
  timing.start('publish')
  now = 200
  timing.finish()
  timing.finish()
  const completed = report.mock.calls
    .filter(([event]) => event === 'stage_completed')
    .map(([, detail]) => detail.timing)
  expect(completed.map(({ stage, durationMs }) => [stage, durationMs])).toEqual([
    ['environment', 10],
    ['transfer', 20],
    ['model', 30],
    ['browser', 100],
    ['model', 10],
    ['validation', 10],
    ['publish', 20],
  ])
})

it('does not infer browser timing from narrative or ordinary commands', () => {
  const report = vi.fn()
  const timing = createBuildTimingReporter(report)
  timing.activity('agent_started')
  timing.activity('agent_message', { text: 'browser-acceptance.mjs is about to run' })
  timing.activity('command_started', { id: 'other', input: 'node unrelated.mjs' })
  timing.activity('command_started', { id: 'read', input: 'cat assets/starter/work/browser-acceptance.mjs' })
  timing.finish()
  expect(report.mock.calls.filter(([event]) => event === 'stage_started')).toHaveLength(1)
})

it('persists only finite, nonnegative, known timing fields', () => {
  expect(readBuildTiming({ stage: 'secret', at: 2 })).toBeUndefined()
  expect(readBuildTiming({ stage: 'browser', at: 2, durationMs: -1 })).toBeUndefined()
  const timing = { stage: 'browser' as const, at: 20, durationMs: 10 }
  const detail = sanitizeBuildActivityDetail({ timing }, [])
  expect(readBuildActivityDetail(JSON.stringify({ version: 1, detail }))?.timing).toEqual(timing)
})
