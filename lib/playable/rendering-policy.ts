import type { ConfirmedBuildInput } from './playable-agent-adapter'
import type { ConfirmationProposal, RevisionProposal } from './schemas'

export const RENDERING_BUILD_PROMPT =
  'Uploaded GLB files are real 3D meshes with embedded textures, not screenshot references or flat sprites. Read asset-manifest.json model metadata and sources[].treatment to map each filename to its declared gameplay role. Load and clone the original GLB with GLTFLoader, preserve UVs/materials, and retain scene hierarchy, skins, morph targets and animation clips. Select animation clips by actual imported names and confirmed intent. Configure physics independently of the model format: use none for display or authored animation, and separate suitable colliders only when gameplay requires physics. Import GLB files as modules so the bundler embeds them offline; never use CDN decoder URLs or replace models with billboards. Read rendering-plan.json when present and obey its confirmed renderer and physics choices. The host prepares pinned dependencies; do not substitute Canvas 2D for confirmed Three.js or omit confirmed Rapier. For Three.js read references/3d-runtime.md, write work/game.js and work/shell.html, and bundle with assets/starter/work/bundle-playable.mjs into output.html. For JavaScript revisions to a bundled Three.js playable, including patch revisions, edit the source modules and rebundle; never patch minified dependency code or reuse its short variable names for game handlers. If only current-playable.html is available, reconstruct isolated game source and the shell with explicit dependency imports, preserving confirmed behavior and assets, then bundle again. Text-only shell edits do not require reconstructing game logic. Retain the whole-bundle DOM-ready guard and diagnose the first runtime error when loading stalls. For synthesized audio, call start() before stop() on each fresh source. Preserve confirmed gameplay, copy and assets when replacing the rendering layer. When browser acceptance is enabled, include actual interaction, ending and collision assertions in work/scenario.mjs; the normal browser runner checks rendering and physics in the same pass. Test the final bundled output.html after the last edit: loading completes, repeated gameplay inputs change real state, drag handling when used, mute and portrait/landscape resizing work without uncaught errors. A successful bundle or source-only check is not runtime verification. When validation is disabled, skip browser checks and repairs and do not claim runtime verification.'

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
