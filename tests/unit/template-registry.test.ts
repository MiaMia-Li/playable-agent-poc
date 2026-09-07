import { describe, expect, it } from 'vitest'
import { getPlayableMode, PLAYABLE_MODES } from '@/lib/playable/template-registry'

describe('template registry', () => {
  it('registers exactly the four approved C6 modes', () => {
    expect(PLAYABLE_MODES.map((mode) => mode.id)).toEqual([
      'center_collision',
      'top_rack',
      'gravity_fill',
      'perspective_3d',
    ])
  })

  it('rejects custom generation in the POC', () => {
    expect(() => getPlayableMode('custom')).toThrow('Unsupported playable mode: custom')
  })
})
