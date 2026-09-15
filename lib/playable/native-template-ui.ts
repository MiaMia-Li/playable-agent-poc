import type { SourceTemplateId } from './types'

/** 已核对内嵌业务脚本：这些模板自带 CTA 与结算流程，无需再叠加通用界面。 */
const nativeEndings: Record<SourceTemplateId, string> = {
  dragon_slots: '原生 CTA 与 You Win 结算动画',
  dragon_reward_wheel: '原生领取／下载按钮与转盘集奖结算',
  zeus_scatter: 'Mega Win 结算与 Collect 按钮',
  balloon_master: '完成两层后的原生 EndCard 与 DownloadButton',
}

export const NATIVE_END_CARD_TREATMENT = '复用模板原生结束页，不新增通用结束卡'
// 标记表示已检查重复界面，用于快速修改准入；它本身不能证明验收通过。
export const NATIVE_UI_MARKER = 'playable-native-ui-preserved-v1'

export function nativeTemplateUiPolicy(sourceTemplateId?: SourceTemplateId | null) {
  if (!sourceTemplateId) return null
  return {
    sourceTemplateId,
    description: nativeEndings[sourceTemplateId],
    cta: 'reuse-native',
    endCard: 'reuse-native',
    allowAdditionalCta: false,
    allowAdditionalEndCard: false,
  } as const
}

export const NATIVE_TEMPLATE_UI_PROMPT = `The following rules apply only when template-ui-policy.json is present; otherwise follow the selected skill’s UI requirements. Read this server-selected policy, which requires reusing the template's native CTA and win/result/end-card flow.
Do not add a second CTA button, generic HTML overlay, separate end screen, or an extra end-card stage. Do not replace native You Win, Mega Win, Collect or Download UI with a generic campaign screen.
For existing revisions, remove previously added generic CTA/end-card overlays when they duplicate the native flow; preserve the native controls, engine transitions, animations and assets.
Apply explicitly requested text, artwork or store URL changes to existing native controls. Generic default copy/resource fields do not authorize adding UI. An empty CTA text means preserve native text/artwork. Bind the approved store URL to the native handler without adding another button.
If native UI has no title/disclaimer/text field, do not invent one to satisfy the campaign binding contract. Omit the campaign-binding marker if its full contract cannot be implemented without new UI.
During full acceptance, exercise the original end condition, verify that only the native ending appears and the native CTA remains usable; do not require an extra DOM CTA or a generic end-card selector. Only after verifying the absence of duplicate UI add ${NATIVE_UI_MARKER} to the runtime. Never add a marker as a substitute for fixing duplicate UI.`
