import { expect, it } from 'vitest'
import { resolveBuildBaseline } from '@/lib/playable/build-baseline'
import { selectSourceHtml } from '@/lib/playable/source-html'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import type { PlayableAsset } from '@/lib/playable/task-assets'

const builds = [1, 2].map((version) => ({
  id: `b${version}`,
  artifactKey: `v${version}`,
  confirmation: {} as ConfirmationProposal,
}))
const input = { builds, latestArtifactKey: 'v2', htmlAttachmentIds: ['ref1', 'ref2'] }

// 上传多个 HTML 本身不构成切换授权；无已有产物时也不能默认挑最后上传的文件。
it('keeps the current version when several new HTML attachments are present', () => {
  expect(resolveBuildBaseline(input)).toEqual({ kind: 'version', version: 2, buildId: 'b2' })
  expect(resolveBuildBaseline({ ...input, latestArtifactKey: null, builds: [] })).toEqual({ kind: 'new' })
  const assets = ['ref1', 'ref2'].map((id) => ({ id, slot: 'sourceHtml' }) as PlayableAsset)
  expect(selectSourceHtml(assets, ['ref2'])).toBeUndefined()
  expect(selectSourceHtml(assets, ['ref2'], 'ref1')?.id).toBe('ref1')
})

// 即使 ID 存在，也必须属于可用附件，且版本号、构建 ID 与手动选择不能互相矛盾。
it('validates explicit file and historical version choices against task inputs', () => {
  expect(resolveBuildBaseline({ ...input, proposed: { kind: 'uploaded_html', assetId: 'ref1' } })).toEqual({
    kind: 'uploaded_html',
    assetId: 'ref1',
  })
  expect(() => resolveBuildBaseline({ ...input, proposed: { kind: 'uploaded_html', assetId: 'foreign' } })).toThrow()
  expect(() => resolveBuildBaseline({ ...input, proposed: { kind: 'version', version: 1, buildId: 'b2' } })).toThrow()
  expect(() =>
    resolveBuildBaseline({
      ...input,
      proposed: { kind: 'uploaded_html', assetId: 'ref1' },
      lockedBase: { version: 2, buildId: 'b2' },
    }),
  ).toThrow()
  expect(resolveBuildBaseline({ ...input, requestedBaseVersion: 1 })).toEqual({
    kind: 'version',
    version: 1,
    buildId: 'b1',
  })
})
