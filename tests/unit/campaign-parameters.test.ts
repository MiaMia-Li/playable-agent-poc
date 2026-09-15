import { expect, it } from 'vitest'
import { applyCampaignParameters, campaignParameters } from '@/lib/playable/campaign-parameters'
import { fastPreviewTemplateIds, supportsFastPreview } from '@/lib/playable/preview-build'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { playableModeIds, sourceTemplateIds } from '@/lib/playable/types'

it('covers exactly eight registered templates', () => {
  expect(new Set(fastPreviewTemplateIds).size).toBe(8)
})
it.each(fastPreviewTemplateIds)('safely patches campaign data for %s', (templateId) => {
  const source = sourceTemplateIds.find((id) => id === templateId)
  const before = {
    mode: playableModeIds.find((id) => id === templateId) ?? 'gravity_fill',
    ...(source ? { sourceTemplateId: source } : {}),
    routing: { match: 'exact', confidence: 1, differences: [] },
    copy: { title: 'Old', cta: 'Play', disclaimer: '', locale: 'en' },
    storeUrl: 'https://example.com',
    gameplay: 'same',
    resources: Object.fromEntries(
      ['tileFaces', 'backgroundBoard', 'animationEffects', 'audio', 'endCard'].map((slot) => [
        slot,
        { status: '内置默认', treatment: 'default' },
      ]),
    ) as ConfirmationProposal['resources'],
    delivery: { network: 'applovin', logicalWidth: 360, logicalHeight: 640, output: 'single-html', maxBytes: 5242880 },
  } as ConfirmationProposal
  const after = { ...before, copy: { ...before.copy, title: '</script><script>alert(1)</script>' } }
  const html = `<script id="playable-campaign-config" type="application/json">${JSON.stringify(campaignParameters(before))}</script><script>/*playable-campaign-binding-v1*/nativeEngine()</script>`
  const result = applyCampaignParameters(html, before, after)!
  expect(supportsFastPreview(before)).toBe(true)
  expect(result).not.toBeNull()
  expect(result).toContain('nativeEngine()')
  expect(result).not.toContain('</script><script>alert')
  expect(JSON.parse(result.match(/application\/json">(.*?)<\/script>/)![1])).toEqual(campaignParameters(after))
  expect(applyCampaignParameters(html, before, { ...after, gameplay: 'different' })).toBeNull()
  expect(applyCampaignParameters(html.replace('playable-campaign-binding-v1', ''), before, after)).toBeNull()
  expect(applyCampaignParameters(html.replace('Old', 'unexpected'), before, after)).toBeNull()
})
