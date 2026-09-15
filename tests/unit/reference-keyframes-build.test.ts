import { describe, expect, it } from 'vitest'
import {
  parseVisualComparison,
  referenceKeyframeWorkspaceFiles,
  referenceVisualsBuildPrompt,
  VISUAL_COMPARISON_WORKSPACE_PATH,
} from '@/lib/playable/reference-keyframes-build'

const keyframes = [
  { seconds: 1, focus: '主界面布局', mimeType: 'image/jpeg' as const, bytes: new Uint8Array([1]) },
  { seconds: 29, focus: 'EPIC WIN 结算页', mimeType: 'image/jpeg' as const, bytes: new Uint8Array([2]) },
]

describe('reference keyframes in the build workspace', () => {
  it('writes numbered images and a manifest saying what each is for', () => {
    const files = referenceKeyframeWorkspaceFiles(keyframes)
    expect(files.map((file) => file.path)).toEqual([
      'reference-keyframes/1.jpg',
      'reference-keyframes/2.jpg',
      'reference-keyframes.json',
    ])
    expect(JSON.parse(new TextDecoder().decode(files[2].bytes))).toEqual([
      { workspacePath: 'reference-keyframes/1.jpg', seconds: 1, focus: '主界面布局' },
      { workspacePath: 'reference-keyframes/2.jpg', seconds: 29, focus: 'EPIC WIN 结算页' },
    ])
    expect(referenceKeyframeWorkspaceFiles(undefined)).toEqual([])
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
