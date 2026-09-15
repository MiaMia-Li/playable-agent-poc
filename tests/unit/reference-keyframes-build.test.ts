import { describe, expect, it } from 'vitest'
import {
  parseVisualComparison,
  referenceKeyframeWorkspaceFiles,
  referenceVisualsBuildPrompt,
  VISUAL_COMPARISON_WORKSPACE_PATH,
} from '@/lib/playable/reference-keyframes-build'

const frame = (keyframeIndex: number, labelledSeconds: number, seconds: number, focus: string, byte: number) => ({
  keyframeIndex,
  labelledSeconds,
  seconds,
  focus,
  mimeType: 'image/jpeg' as const,
  bytes: new Uint8Array([byte]),
})

const keyframes = [
  frame(0, 1, 1, '主界面布局', 1),
  frame(2, 29, 29, 'EPIC WIN 结算页', 2),
  frame(2, 29, 30, 'EPIC WIN 结算页', 3),
]

describe('reference keyframes in the build workspace', () => {
  // The frames of one moment are candidates for the same thing, so the agent
  // sees them together and picks the one that shows it.
  it('writes numbered images and a manifest grouping each moment with its frames', () => {
    const files = referenceKeyframeWorkspaceFiles(keyframes)
    expect(files.map((file) => file.path)).toEqual([
      'reference-keyframes/1-1.jpg',
      'reference-keyframes/2-1.jpg',
      'reference-keyframes/2-2.jpg',
      'reference-keyframes.json',
    ])
    expect(JSON.parse(new TextDecoder().decode(files[3].bytes))).toEqual([
      {
        focus: '主界面布局',
        labelledSeconds: 1,
        frames: [{ workspacePath: 'reference-keyframes/1-1.jpg', seconds: 1 }],
      },
      {
        focus: 'EPIC WIN 结算页',
        labelledSeconds: 29,
        frames: [
          { workspacePath: 'reference-keyframes/2-1.jpg', seconds: 29 },
          { workspacePath: 'reference-keyframes/2-2.jpg', seconds: 30 },
        ],
      },
    ])
    expect(referenceKeyframeWorkspaceFiles(undefined)).toEqual([])
  })

  it('tells the agent to pick the frame that shows the moment and to trust images over text', () => {
    const prompt = referenceVisualsBuildPrompt({ visualDirection: 'match_reference', hasKeyframes: true, patch: false })
    expect(prompt).toContain('run early')
    expect(prompt).toContain('trust the images')
  })

  it('makes the visual spec the target only when matching the reference', () => {
    const matching = referenceVisualsBuildPrompt({
      visualDirection: 'match_reference',
      hasKeyframes: true,
      patch: false,
    })
    expect(matching).toContain('visual target')
    expect(matching).toContain('reference-keyframes.json')
    expect(matching).toContain('never embed them')
    expect(matching).toContain(VISUAL_COMPARISON_WORKSPACE_PATH)

    const withoutKeyframes = referenceVisualsBuildPrompt({
      visualDirection: 'match_reference',
      hasKeyframes: false,
      patch: false,
    })
    expect(withoutKeyframes).toContain('visual target')
    expect(withoutKeyframes).not.toContain('reference-keyframes.json')

    expect(referenceVisualsBuildPrompt({ visualDirection: 'custom', hasKeyframes: false, patch: false })).toContain(
      'do not take the appearance',
    )
  })

  // Restyling a whole playable is not a scoped change.
  it('leaves a patch alone', () => {
    expect(referenceVisualsBuildPrompt({ visualDirection: 'match_reference', hasKeyframes: true, patch: true })).toBe(
      '',
    )
  })

  // A record, not a gate: anything unusable is dropped, never a build failure.
  it('keeps a well-formed comparison and drops anything else', () => {
    const comparison = [{ keyframe: 'reference-keyframes/1.jpg', matched: ['顶部 Jackpot 面板'], missed: ['彩虹背景'] }]
    expect(parseVisualComparison(JSON.stringify(comparison))).toEqual(comparison)
    expect(parseVisualComparison(null)).toBeUndefined()
    expect(parseVisualComparison('not json')).toBeUndefined()
    expect(parseVisualComparison(JSON.stringify({ keyframe: 'x' }))).toBeUndefined()
    expect(parseVisualComparison('x'.repeat(70_000))).toBeUndefined()
  })
})
