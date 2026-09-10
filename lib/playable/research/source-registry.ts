import { createHash } from 'node:crypto'
import type { SearchBrief } from './schemas'

export const CURATED_RESEARCH_SOURCES = [
  { id: 'tiktok-creative-center', domains: ['ads.tiktok.com'] },
  { id: 'google-ads-transparency', domains: ['adstransparency.google.com'] },
  { id: 'meta-ad-library', domains: ['facebook.com'] },
  { id: 'applovin-resources', domains: ['applovin.com'] },
  { id: 'liftoff-resources', domains: ['liftoff.io'] },
] as const

export const MARKET_RESEARCH_STRATEGY_VERSION = 'public-web-v1'
export const MARKET_RESEARCH_CACHE_TTL_MS = 86_400_000

const TRACKING_PARAMETERS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid'])

export function allowedResearchDomains(): string[] {
  return CURATED_RESEARCH_SOURCES.flatMap((source) => [...source.domains])
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function parseAllowedUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined
    const hostname = url.hostname.toLowerCase()
    if (!allowedResearchDomains().some((domain) => domainMatches(hostname, domain))) return undefined
    return url
  } catch {
    return undefined
  }
}

export function isAllowedResearchUrl(value: string): boolean {
  return Boolean(parseAllowedUrl(value))
}

export function researchSourceIdForUrl(value: string): string | undefined {
  const url = parseAllowedUrl(value)
  if (!url) return undefined
  return CURATED_RESEARCH_SOURCES.find((source) =>
    source.domains.some((domain) => domainMatches(url.hostname.toLowerCase(), domain)),
  )?.id
}

export function canonicalResearchUrl(value: string): string | undefined {
  const url = parseAllowedUrl(value)
  if (!url) return undefined
  url.hostname = url.hostname.toLowerCase()
  url.pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '')
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  return url.toString().replace(/\/$/, '')
}

function normalizedList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))].sort()
}

export function createResearchCacheKey(brief: SearchBrief): string {
  const normalized = {
    version: brief.version,
    category: brief.category.trim().toLocaleLowerCase(),
    subcategory: brief.subcategory.trim().toLocaleLowerCase(),
    gameplayKeywords: normalizedList(brief.gameplayKeywords),
    market: brief.market.trim().toLocaleLowerCase(),
    locale: brief.locale.trim().toLocaleLowerCase(),
    adNetwork: brief.adNetwork.trim().toLocaleLowerCase(),
    timeRange: brief.timeRange.trim().toLocaleLowerCase(),
    focusAreas: normalizedList(brief.focusAreas),
    requirementSummary: brief.requirementSummary.trim().toLocaleLowerCase(),
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
