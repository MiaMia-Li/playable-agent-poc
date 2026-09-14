import { describe, expect, it } from 'vitest'
import { cliBuildActivity, harnessBuildActivity, buildEventLabel } from '@/lib/playable/build-activity'

describe('build activity boundary', () => {
  it('does not expose private text or confuse steps with build completion', () => {
    for (const type of ['reasoning-delta', 'text-delta', 'finish-step', 'finish', 'raw']) {
      expect(harnessBuildActivity({ type, text: 'secret', rawValue: 'secret' })).toBeUndefined()
    }
    expect(cliBuildActivity({ type: 'item.completed', item: { type: 'reasoning', text: 'secret' } })).toBeUndefined()
    expect(cliBuildActivity({ type: 'turn.completed' })).toBeUndefined()
    expect(buildEventLabel('build_activity_toString')).toBeUndefined()
    expect(buildEventLabel('secret')).toBeUndefined()
  })

  it('reports failed commands even when the outer tool result completed', () => {
    expect(
      harnessBuildActivity({ type: 'tool-result', toolName: 'bash', output: { exitCode: 1, output: 'secret' } }),
    ).toBe('command_failed')
    expect(
      cliBuildActivity({
        type: 'item.completed',
        item: { type: 'command_execution', exit_code: 1, aggregated_output: 'secret' },
      }),
    ).toBe('command_failed')
    expect(harnessBuildActivity({ type: 'tool-result', toolName: 'bash', output: { exitCode: 0 } })).toBe(
      'command_completed',
    )
  })

  it('handles synthetic file changes once and ignores preliminary results', () => {
    expect(
      harnessBuildActivity({ type: 'tool-call', toolName: 'fileChange', input: { path: '/private' } }),
    ).toBeUndefined()
    expect(harnessBuildActivity({ type: 'tool-result', toolName: 'fileChange', output: { path: '/private' } })).toBe(
      'file_changed',
    )
    expect(harnessBuildActivity({ type: 'tool-result', toolName: 'bash', preliminary: true })).toBeUndefined()
  })
})
