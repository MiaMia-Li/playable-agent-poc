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
  version: 4,
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
  visualSpec: { artStyle: '卡通', palette: [], background: '', layout: [], uiComponents: [], entityLooks: [], effects: [] },
  keyframes: [],
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

  it('asks for the visual spec and keyframes after the timeline', () => {
    const keys = Object.keys(blueprintResponseSchema().properties as Record<string, unknown>)
    expect(keys.indexOf('timeline')).toBeLessThan(keys.indexOf('visualSpec'))
    expect(keys.indexOf('visualSpec')).toBeLessThan(keys.indexOf('keyframes'))
    expect(keys).not.toContain('visualStyle')
  })

  // The gateway returns a bare 400 for the bounds zod emits; `pattern` is
  // stripped with them rather than risking every analysis on it.
  it('sends no regex pattern to the model', () => {
    expect(JSON.stringify(blueprintResponseSchema())).not.toContain('"pattern"')
  })

  // An off-format colour is the same colour, not worth a billed retry.
  it('normalises palette colours and still rejects something that is not a colour', () => {
    const withPalette = (hex: string) =>
      JSON.stringify({ ...blueprint, visualSpec: { ...blueprint.visualSpec, palette: [{ hex, usage: '背景' }] } })
    expect(parseBlueprint(withPalette('F5AABB')).visualSpec.palette[0].hex).toBe('#F5AABB')
    expect(parseBlueprint(withPalette(' #f5a ')).visualSpec.palette[0].hex).toBe('#ff55aa')
    expect(() => parseBlueprint(withPalette('pink'))).toThrow()
  })

  it('orders keyframes and drops ones that would cut out the same frame', () => {
    const parsed = parseBlueprint(
      JSON.stringify({
        ...blueprint,
        keyframes: [
          { seconds: 9, focus: '结算页' },
          { seconds: 2, focus: '主界面' },
          { seconds: 2.3, focus: '主界面近似' },
        ],
      }),
    )
    expect(parsed.keyframes.map((keyframe) => keyframe.focus)).toEqual(['主界面', '结算页'])
  })

  // ffmpeg yields nothing at the exact end of the stream.
  it('pulls a keyframe on the last second inside the video and rejects one well past it', () => {
    const validated = validateEvidenceTimes({ ...blueprint, keyframes: [{ seconds: 22, focus: '结算页' }] }, 21.1)
    expect(validated.keyframes[0].seconds).toBeCloseTo(21.05)
    expect(() => validateEvidenceTimes({ ...blueprint, keyframes: [{ seconds: 30, focus: '结算页' }] }, 21.1)).toThrow()
  })

  it('checks visual evidence against the video duration', () => {
    const effect = {
      name: '倍数放大',
      trigger: '中奖',
      motion: '弹簧缩放',
      evidence: [{ startSeconds: 24, endSeconds: 40, observation: '倍数从 x1 升到 x1000' }],
    }
    expect(() =>
      validateEvidenceTimes({ ...blueprint, visualSpec: { ...blueprint.visualSpec, effects: [effect] } }, 28),
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
