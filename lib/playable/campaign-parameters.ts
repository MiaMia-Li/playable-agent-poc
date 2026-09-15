import type { ConfirmationProposal } from './schemas'
import { fastPreviewTemplateIds } from './preview-build'

const campaignBlock =
  /(<script\b(?=[^>]*\bid=["']playable-campaign-config["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>)([\s\S]*?)(<\/script>)/i
export const campaignParameters = (confirmation: ConfirmationProposal) => ({
  templateId: confirmation.sourceTemplateId ?? confirmation.mode,
  copy: confirmation.copy,
  storeUrl: confirmation.storeUrl,
})

/** 仅对已绑定配置的正式基线做参数替换；不改脚本逻辑，不凭自然语言猜测状态机改动。 */
export function applyCampaignParameters(
  html: string,
  before: ConfirmationProposal,
  after: ConfirmationProposal,
): string | null {
  const oldConfig = campaignParameters(before)
  const nextConfig = campaignParameters(after)
  if (!fastPreviewTemplateIds.includes(nextConfig.templateId) || oldConfig.templateId !== nextConfig.templateId)
    return null
  const { copy: _copy, storeUrl: _store, presentation: _presentation, ...previous } = before
  const { copy: _nextCopy, storeUrl: _nextStore, presentation: _nextPresentation, ...next } = after
  void [_copy, _store, _presentation, _nextCopy, _nextStore, _nextPresentation]
  if (JSON.stringify(previous) !== JSON.stringify(next)) return null
  const match = campaignBlock.exec(html)
  if (!match || !html.includes('playable-campaign-binding-v1')) return null
  try {
    if (JSON.stringify(JSON.parse(match[2])) !== JSON.stringify(oldConfig)) return null
  } catch {
    return null
  }
  const encoded = JSON.stringify(nextConfig)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return html.replace(campaignBlock, (_match, open: string, _content: string, close: string) => open + encoded + close)
}
