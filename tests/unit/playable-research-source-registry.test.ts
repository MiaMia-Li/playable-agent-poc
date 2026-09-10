import { describe, expect, it } from 'vitest'
import {
  allowedResearchDomains,
  canonicalResearchUrl,
  createResearchCacheKey,
  isAllowedResearchUrl,
} from '@/lib/playable/research/source-registry'
import type { SearchBrief } from '@/lib/playable/research/schemas'

const brief: SearchBrief = {
  version: 1,
  trigger: 'explicit',
  category: '消除',
  subcategory: '麻将配对',
  gameplayKeywords: ['牌架', '点击'],
  market: '全球',
  locale: 'zh-CN',
  adNetwork: 'AppLovin',
  timeRange: '最近 90 天',
  focusAreas: ['前三秒', 'CTA'],
  requirementSummary: '寻找同类案例',
}

describe('playable research source registry', () => {
  it.each([
    'https://ads.tiktok.com/business/creativecenter/example',
    'https://adstransparency.google.com/advertiser/example',
    'https://www.facebook.com/ads/library/example',
    'https://www.applovin.com/blog/example',
    'https://info.liftoff.io/reports/example',
  ])('accepts a curated HTTPS source: %s', (url) => {
    expect(isAllowedResearchUrl(url)).toBe(true)
  })

  it('exports only canonical domain names', () => {
    expect(allowedResearchDomains()).toEqual([
      'ads.tiktok.com',
      'adstransparency.google.com',
      'facebook.com',
      'applovin.com',
      'liftoff.io',
    ])
  })

  it.each([
    'http://ads.tiktok.com/example',
    'https://user:secret@ads.tiktok.com/example',
    'https://ads.tiktok.com.evil.example/example',
    'https://localhost/example',
    'https://127.0.0.1/example',
    'https://example.com/ad',
    'https://ads.tiktok.com/example#hidden',
  ])('rejects an unsafe or unregistered URL: %s', (url) => {
    expect(isAllowedResearchUrl(url)).toBe(false)
  })

  it('canonicalizes safe source URLs without tracking parameters', () => {
    expect(canonicalResearchUrl('https://ADS.TIKTOK.COM/example/?utm_source=test&b=2&a=1')).toBe(
      'https://ads.tiktok.com/example?a=1&b=2',
    )
  })

  it('creates the same cache key for equivalent normalized briefs', () => {
    const reordered: SearchBrief = {
      ...brief,
      trigger: 'suggested_confirmed',
      gameplayKeywords: [' 点击 ', '牌架'],
      focusAreas: ['CTA', '前三秒'],
    }

    expect(createResearchCacheKey(brief)).toBe(createResearchCacheKey(reordered))
  })
})
