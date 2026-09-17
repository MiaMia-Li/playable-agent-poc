import type { ConfirmedBuildInput } from './playable-agent-adapter'
import type { ConfirmationProposal, RevisionProposal } from './schemas'

export const RENDERING_BUILD_PROMPT =
  'Read rendering-plan.json when present and obey its confirmed renderer and physics choices. The host prepares pinned dependencies; do not substitute Canvas 2D for confirmed Three.js or omit confirmed Rapier. For Three.js read references/3d-runtime.md, write work/game.js and work/shell.html, and bundle with assets/starter/work/bundle-playable.mjs into output.html. Preserve confirmed gameplay, copy and assets when replacing the rendering layer. When browser acceptance is enabled, include actual interaction, ending and collision assertions in work/scenario.mjs; the normal browser runner checks rendering and physics in the same pass. When validation is disabled, skip browser checks and repairs and do not claim runtime verification.'

export function renderingPreparationCommand(confirmation: ConfirmationProposal): string | undefined {
  if (confirmation.rendering?.renderer !== 'threejs') return
  return `node assets/starter/work/bundle-playable.mjs prepare ${confirmation.rendering.physics === 'rapier' ? 'three-physics' : 'three'}`
}

export function renderingChanged(
  confirmation: ConfirmationProposal,
  base?: ConfirmationProposal,
  baseHtml?: string,
): boolean {
  const next = confirmation.rendering
  if (!next || next.renderer === 'template') return false
  if (base?.rendering) return next.renderer !== base.rendering.renderer || next.physics !== base.rendering.physics
  // Legacy freeform modes are scaffold labels, not evidence of a real WebGL renderer.
  if (next.renderer === 'threejs' && baseHtml)
    return (
      /getContext\(\s*['"]2d['"]/.test(baseHtml) ||
      !/WebGLRenderer|three\.js/.test(baseHtml) ||
      next.physics === 'rapier'
    )
  return next.renderer === 'threejs' // Legacy metadata cannot prove the required engine is present.
}

export function renderingRevision(
  confirmation: ConfirmationProposal,
  revision: RevisionProposal | undefined,
  base?: ConfirmationProposal,
  baseHtml?: string,
): RevisionProposal | undefined {
  if (!revision || !renderingChanged(confirmation, base, baseHtml)) return revision
  return { ...revision, strategy: 'regenerate', parameterOnly: false }
}

export function applyRenderingBuildPolicy(input: ConfirmedBuildInput): ConfirmedBuildInput {
  return {
    ...input,
    revision: renderingRevision(input.confirmation, input.revision, input.baseConfirmation, input.baseHtml),
  }
}
