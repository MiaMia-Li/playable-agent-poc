import { describe, expect, it } from 'vitest'
import type { GameplayBlueprint, GameplayTimelineSegment } from '@/lib/playable/schemas'
import { blueprintResponseSchema, parseBlueprint, validateEvidenceTimes } from '@/lib/playable/video-gameplay-analyst'

function segment(startSeconds: number, endSeconds: number): GameplayTimelineSegment {
  return {
    startSeconds,
    endSeconds,
    phase: 'gameplay',
    screen: '选角界面',
    onScreenText: '',
    playerInput: { action: 'tap', target: '英雄', seenVia: 'ui_response' },
    response: '英雄被选中',
    audioCue: '',
    confidence: 0.7,
  }
}

const blueprint: GameplayBlueprint = {
  version: 3,
  summary: '依次选择英雄',
  orientation: 'portrait',
  timeline: [],
  controls: [],
  sceneStructure: { value: '选角界面', confidence: 0.9, evidence: [] },
  entities: [],
  coreLoop: { value: '选择英雄', confidence: 0.8, evidence: [] },
  stateTransitions: [],
  objective: { value: '组队', confidence: 0.7, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  visualStyle: '卡通',
  audio: [],
  intentDivergence: [],
  uncertainties: [],
  overallConfidence: 0.8,
}

describe('gameplay timeline in the blueprint', () => {
  // The user reviews the timeline top to bottom, so its order cannot be left
  // to however the model happened to write it.
  it('sorts the timeline by start time when parsing', () => {
    const parsed = parseBlueprint(JSON.stringify({ ...blueprint, timeline: [segment(12, 13), segment(10, 11)] }))
    expect(parsed.timeline.map((entry) => entry.startSeconds)).toEqual([10, 12])
  })

  it('accepts a segment with no player input, such as automatic play', () => {
    const parsed = parseBlueprint(JSON.stringify({ ...blueprint, timeline: [{ ...segment(0, 3), playerInput: null }] }))
    expect(parsed.timeline[0].playerInput).toBeNull()
  })

  it('rejects a segment that runs past the end of the video', () => {
    expect(() => validateEvidenceTimes({ ...blueprint, timeline: [segment(10, 20)] }, 16)).toThrow()
    expect(validateEvidenceTimes({ ...blueprint, timeline: [segment(10, 16.4)] }, 16).timeline).toHaveLength(1)
  })

  // Overlap is not worth a billed retry; the user sees the segments as written.
  it('tolerates overlapping segments', () => {
    expect(() =>
      validateEvidenceTimes({ ...blueprint, timeline: [segment(10, 12), segment(11, 13)] }, 16),
    ).not.toThrow()
  })

  // Property order in the response schema is the order the model writes in,
  // and the thematic fields should be drawn from a timeline already written.
  it('asks the model for the timeline before the thematic fields', () => {
    const keys = Object.keys(blueprintResponseSchema().properties as Record<string, unknown>)
    expect(keys.indexOf('timeline')).toBeGreaterThan(-1)
    expect(keys.indexOf('timeline')).toBeLessThan(keys.indexOf('controls'))
  })
})
