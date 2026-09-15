import type { ConfirmationProposal } from './schemas'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'

type TemplateSelection = Pick<ConfirmationProposal, 'sourceTemplateId' | 'mode' | 'routing'>

/** 独立 HTML 模板与自由生成都不能继承旧 mode 的 Three.js 约束。 */
export function usesPerspectiveTemplate(selection: TemplateSelection): boolean {
  return !selection.sourceTemplateId && selection.routing.match !== 'freeform' && selection.mode === 'perspective_3d'
}

/** 所有玩法共用宽泛的产物契约；具体玩法行为由浏览器验收按确认需求判断。 */
export function buildValidationCommand(_selection: Pick<TemplateSelection, 'sourceTemplateId' | 'routing'>): string {
  return MAHJONG_PLAYABLE_PLUGIN.commands.validateFreeform
}
