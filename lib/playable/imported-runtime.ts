import type { ConfirmedBuildInput } from './playable-agent-adapter'

// HTML 源码模式也可能依赖 Spine，因此运行时准备独立于模板选择，并按已确认渲染方式执行。
export function importedRuntimePreparationCommand(input: ConfirmedBuildInput): string | undefined {
  if (!input.importedAssets?.some((item) => item.spine.length)) return
  const rendering = input.confirmation.rendering
  const mode = rendering?.renderer === 'threejs' ? (rendering.physics === 'rapier' ? 'three-physics' : 'three') : '2d'
  return `node assets/starter/work/bundle-playable.mjs prepare ${mode}`
}
