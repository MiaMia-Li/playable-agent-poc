import type { BuildBaseline, ConfirmationProposal } from './schemas'

type SavedBuild = { id: string; artifactKey: string | null; confirmation: ConfirmationProposal }

/** 将模型提出的基底解析到本任务的真实输入；附件顺序和修改策略均不能隐式切换源码。 */
export function resolveBuildBaseline(input: {
  proposed?: BuildBaseline | null
  builds: SavedBuild[]
  latestArtifactKey: string | null
  htmlAttachmentIds: string[]
  requestedBaseVersion?: number | null
  lockedBase?: { buildId: string; version: number }
  existingSourceId?: string
}): BuildBaseline {
  // 版本序号按已保存产物排列；待验收产物也可作基底，不能仅筛选验收成功的构建。
  const builds = input.builds.filter((build) => build.artifactKey)
  let baseline = input.proposed
  // 手动选择优先于模型推断；发生冲突直接拒绝，不能悄悄改用模型提出的另一份源码。
  if (input.lockedBase) {
    if (
      baseline &&
      (baseline.kind !== 'version' ||
        baseline.buildId !== input.lockedBase.buildId ||
        baseline.version !== input.lockedBase.version)
    )
      throw new Error('Revision base version conflict')
    baseline = { kind: 'version', buildId: input.lockedBase.buildId, version: input.lockedBase.version }
  }
  // 兼容尚无 baseline 字段的方案：优先已请求或当前版本，只有无产物时才恢复既有源码绑定。
  if (!baseline) {
    const index =
      input.requestedBaseVersion != null
        ? input.requestedBaseVersion - 1
        : builds.findIndex((build) => build.artifactKey === input.latestArtifactKey)
    if (index >= 0 && builds[index]) baseline = { kind: 'version', buildId: builds[index].id, version: index + 1 }
    else if (input.requestedBaseVersion != null) throw new Error('Revision base version is unavailable')
    else
      baseline = input.existingSourceId ? { kind: 'uploaded_html', assetId: input.existingSourceId } : { kind: 'new' }
  }
  // 同时核对序号和构建 ID，避免模型把某个版本号与另一份真实产物拼在一起。
  if (baseline.kind === 'version') {
    if (builds[baseline.version - 1]?.id !== baseline.buildId) throw new Error('Revision base version is unavailable')
    if (input.requestedBaseVersion != null && input.requestedBaseVersion !== baseline.version)
      throw new Error('Revision base version conflict')
  }
  if (baseline.kind === 'uploaded_html' && !input.htmlAttachmentIds.includes(baseline.assetId))
    throw new Error('HTML baseline is not an available conversation attachment')
  return baseline
}

export function buildBaselineLabel(
  confirmation: Pick<ConfirmationProposal, 'baseline'>,
  assets: { id: string; filename: string }[] = [],
) {
  const baseline = confirmation.baseline
  if (!baseline) return undefined
  if (baseline.kind === 'version') return `基于 v${baseline.version}`
  if (baseline.kind === 'uploaded_html')
    return `基于 ${assets.find((asset) => asset.id === baseline.assetId)?.filename ?? '已选 HTML'}`
  return '从确认方案开始制作'
}
