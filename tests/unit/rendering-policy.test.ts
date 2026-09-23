import { expect, it } from 'vitest'
import { renderingChanged, renderingRevision, renderingPreparationCommand } from '@/lib/playable/rendering-policy'
import { confirmationProposalSchema, type ConfirmationProposal, type RevisionProposal } from '@/lib/playable/schemas'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const { runtimeEvidenceChecks } = await import(
  pathToFileURL(path.resolve('skills/_shared/assets/starter/work/runtime-evidence.mjs')).href
)
const confirmation = confirmationProposalSchema.parse({
  mode: 'perspective_3d',
  routing: { match: 'freeform', confidence: 1, differences: ['custom physics'] },
  gameplay: '炮弹击中积木，积木受力并坍塌',
  rendering: { renderer: 'threejs', physics: 'rapier', reason: '空间碰撞与失去支撑后坍塌' },
  resources: Object.fromEntries(
    ['tileFaces', 'backgroundBoard', 'animationEffects', 'audio', 'endCard'].map((key) => [
      key,
      { status: '内置默认', treatment: '默认' },
    ]),
  ),
  copy: { title: 'Tower', cta: 'Play', disclaimer: '', locale: 'zh-CN' },
  storeUrl: 'https://example.com',
  delivery: { network: 'applovin', logicalWidth: 360, logicalHeight: 640, output: 'single-html', maxBytes: 5242880 },
})
const revision: RevisionProposal = {
  id: 'r',
  baseBuildId: 'b',
  baseVersion: 1,
  targetVersion: 2,
  strategy: 'patch',
  parameterOnly: true,
  summary: '升级为真实 3D',
  changes: ['升级画面'],
  preserved: ['保留玩法和配色'],
}
it('preserves legacy configurations but rejects contradictory rendering choices', () => {
  const { rendering, ...legacy } = confirmation
  expect(confirmationProposalSchema.parse(legacy).rendering).toBeUndefined()
  expect(
    confirmationProposalSchema.safeParse({ ...confirmation, rendering: { ...rendering, renderer: 'canvas2d' } })
      .success,
  ).toBe(false)
  expect(
    confirmationProposalSchema.safeParse({
      ...confirmation,
      rendering: { renderer: 'template', physics: 'template', reason: 'template' },
    }).success,
  ).toBe(false)
})
// 同一引擎升级需求只有在显式确认 regenerate 后才允许执行，校验函数不能自行改策略。
it('rejects an incompatible patch instead of silently changing the confirmed strategy', () => {
  const { rendering: _, ...base } = confirmation
  void _
  expect(() => renderingRevision(confirmation, revision, base, `canvas.getContext('2d')`)).toThrow(
    'explicitly confirmed',
  )
  const regenerated = { ...revision, strategy: 'regenerate' as const, parameterOnly: false }
  expect(renderingRevision(confirmation, regenerated, base)).toBe(regenerated)
  expect(renderingRevision(confirmation, revision, confirmation)).toBe(revision)
  expect(renderingChanged({ ...base } as ConfirmationProposal, confirmation)).toBe(false)
})
it('prepares only confirmed 3D dependencies', () => {
  expect(renderingPreparationCommand(confirmation)).toContain('prepare three-physics')
  expect(
    renderingPreparationCommand({ ...confirmation, rendering: { ...confirmation.rendering!, physics: 'none' } }),
  ).toContain('prepare three')
  expect(
    renderingPreparationCommand({
      ...confirmation,
      rendering: { renderer: 'canvas2d', physics: 'none', reason: 'flat' },
    }),
  ).toBeUndefined()
})
it('requires actual drawing and post-input Rapier contact evidence, not advertised flags', () => {
  const rendering = confirmation.rendering
  expect(
    runtimeEvidenceChecks(rendering, { ready: true, renderer: 'threejs', physics: 'rapier' }).every(
      (row: [string, boolean]) => row[1],
    ),
  ).toBe(false)
  const evidence = {
    three: true,
    draws: 3,
    visibleCanvas: true,
    variedPixels: true,
    wasm: true,
    steps: 10,
    inputs: 1,
    contacts: 1,
  }
  expect(runtimeEvidenceChecks(rendering, evidence).every((row: [string, boolean]) => row[1])).toBe(true)
  expect(runtimeEvidenceChecks(rendering, { ...evidence, contacts: 0 })[1][1]).toBe(false)
  expect(runtimeEvidenceChecks(rendering, { ...evidence, draws: 0 })[0][1]).toBe(false)
  expect(runtimeEvidenceChecks(undefined, {})).toEqual([])
})
