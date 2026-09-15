import { describe, expect, it } from 'vitest'
import {
  GAMEPLAY_BLUEPRINT_VERSION,
  type GameplayBlueprint,
  type GameplayTimelineSegment,
} from '@/lib/playable/schemas'
import {
  analysisPrompt,
  blueprintResponseSchema,
  describeBlueprintFailure,
  parseBlueprint,
  validateEvidenceTimes,
} from '@/lib/playable/video-gameplay-analyst'

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

  // At one frame per second the model labels whole seconds, so a timeline that
  // covers the whole video ends on the second after the last frame. Rejecting
  // that failed a real run on a 21.1 s recording.
  it('clamps a timeline tail just past the end to the video duration', () => {
    const validated = validateEvidenceTimes({ ...blueprint, timeline: [segment(20, 22)] }, 21.1)
    expect(validated.timeline[0]).toMatchObject({ startSeconds: 20, endSeconds: 21.1 })
  })

  // A prompt still asking for "v2" after the schema moved to 3 made a model
  // that ignores the schema's `const` write 2, failing every attempt.
  it('names the current blueprint version in the prompt', () => {
    const prompt = analysisPrompt({
      prompt: '',
      video: { bytes: new Uint8Array(), mimeType: 'video/mp4', durationSeconds: 21.1 },
    })
    expect(prompt).toContain(`\`version\` set to ${GAMEPLAY_BLUEPRINT_VERSION}`)
    expect(prompt).not.toMatch(/Blueprint v\d/)
  })

  // The first real run came back with every segment's confidence above 1:
  // the bound is stripped from the response schema, so the model never saw it.
  it('reads a percentage confidence as a fraction, and still rejects beyond 100', () => {
    const parsed = parseBlueprint(
      JSON.stringify({ ...blueprint, overallConfidence: 88, timeline: [{ ...segment(0, 1), confidence: 90 }] }),
    )
    expect(parsed.timeline[0].confidence).toBe(0.9)
    expect(parsed.overallConfidence).toBe(0.88)
    expect(() =>
      parseBlueprint(JSON.stringify({ ...blueprint, timeline: [{ ...segment(0, 1), confidence: 150 }] })),
    ).toThrow()
  })

  // The model's text can quote anything in the video, so the log gets the
  // failing stage and schema paths only.
  it('describes an unusable reply by stage and schema path, never by content', () => {
    expect(describeBlueprintFailure(new SyntaxError('Unexpected token'))).toEqual({ stage: 'json' })
    expect(describeBlueprintFailure(new Error('Gameplay blueprint contains invalid evidence timestamps'))).toEqual({
      stage: 'evidence_times',
    })

    let schemaError: unknown
    try {
      parseBlueprint(
        JSON.stringify({ ...blueprint, timeline: [{ ...segment(0, 1), onScreenText: 'secret'.repeat(200) }] }),
      )
    } catch (error) {
      schemaError = error
    }
    const described = describeBlueprintFailure(schemaError)
    expect(described).toEqual({ stage: 'schema', issues: [{ path: 'timeline.0.onScreenText', code: 'too_big' }] })
    expect(JSON.stringify(described)).not.toContain('secret')
  })
})
