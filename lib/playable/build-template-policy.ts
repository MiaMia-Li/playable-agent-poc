import type { ConfirmationProposal } from './schemas'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'

type TemplateSelection = Pick<ConfirmationProposal, 'sourceTemplateId' | 'mode' | 'routing'>

/** 独立 HTML 模板与自由生成都不能继承旧 mode 的 Three.js 约束。 */
export function usesPerspectiveTemplate(selection: TemplateSelection): boolean {
  return !selection.sourceTemplateId && selection.routing.match !== 'freeform' && selection.mode === 'perspective_3d'
}

/** 提示词与应用验收共用同一规则，避免 Agent 的 PASS 来自另一套校验。 */
export function buildValidationCommand(selection: Pick<TemplateSelection, 'sourceTemplateId' | 'routing'>): string {
  return !selection.sourceTemplateId && selection.routing.match === 'exact'
    ? MAHJONG_PLAYABLE_PLUGIN.commands.validate
    : MAHJONG_PLAYABLE_PLUGIN.commands.validateFreeform
}
