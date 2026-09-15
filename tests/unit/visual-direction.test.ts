import { describe, expect, it } from 'vitest'
import { applyVisualDirection, confirmationProposalSchema, MATCH_REFERENCE_DIFFERENCE } from '@/lib/playable/schemas'

const exact = { match: 'exact' as const, confidence: 0.9, differences: [] }

describe('visual direction', () => {
  // An exact route never reads the blueprint, so matching the reference's look
  // on it would silently build the template's art instead (spec §4.2).
  it('lifts an exact route to approximate when matching the reference', () => {
    const applied = applyVisualDirection(
      { visualDirection: 'match_reference' as const, routing: exact },
      { hasReferenceVisuals: true },
    )
    expect(applied.routing).toEqual({
      match: 'approximate',
      confidence: 0.9,
      differences: [MATCH_REFERENCE_DIFFERENCE],
    })
  })

  it('undoes exactly that lift when switched back to custom', () => {
    const lifted = applyVisualDirection(
      { visualDirection: 'match_reference' as const, routing: exact },
      { hasReferenceVisuals: true },
    )
    const reverted = applyVisualDirection(
      { ...lifted, visualDirection: 'custom' as const },
      { hasReferenceVisuals: true },
    )
    expect(reverted.routing).toEqual(exact)
  })

  it('leaves a route approximate for its own reasons alone', () => {
    const routing = { match: 'approximate' as const, confidence: 0.8, differences: ['3D 相机视角'] }
    expect(
      applyVisualDirection({ visualDirection: 'custom' as const, routing }, { hasReferenceVisuals: true }).routing,
    ).toEqual(routing)
    expect(
      applyVisualDirection({ visualDirection: 'match_reference' as const, routing }, { hasReferenceVisuals: true })
        .routing,
    ).toEqual(routing)
  })

  it('forces custom when there is no blueprint to match', () => {
    const applied = applyVisualDirection(
      { visualDirection: 'match_reference' as const, routing: exact },
      { hasReferenceVisuals: false },
    )
    expect(applied).toEqual({ visualDirection: 'custom', routing: exact })
  })

  it('reads a confirmation stored before the field existed as custom', () => {
    const stored = {
      mode: 'center_collision',
      gameplay: '点击配对',
      resources: Object.fromEntries(
        ['tileFaces', 'backgroundBoard', 'animationEffects', 'audio', 'endCard'].map((slot) => [
          slot,
          { status: '内置默认', treatment: '系统素材' },
        ]),
      ),
      copy: { title: '', cta: '', disclaimer: '', locale: 'zh-CN' },
      storeUrl: 'https://example.com/app',
      delivery: { network: 'generic', logicalWidth: 360, logicalHeight: 640, output: 'single-html', maxBytes: null },
    }
    expect(confirmationProposalSchema.parse(stored).visualDirection).toBe('custom')
  })
})
