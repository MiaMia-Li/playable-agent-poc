import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { SearchBrief } from './schemas'

export const CURATED_RESEARCH_SOURCES = [
  { id: 'tiktok-creative-center', domains: ['ads.tiktok.com'] },
  { id: 'google-ads-transparency', domains: ['adstransparency.google.com'] },
  { id: 'meta-ad-library', domains: ['facebook.com'] },
  { id: 'applovin-resources', domains: ['applovin.com'] },
  { id: 'liftoff-resources', domains: ['liftoff.io'] },
] as const

export const MARKET_RESEARCH_STRATEGY_VERSION = 'public-web-v2'
export const MARKET_RESEARCH_CACHE_TTL_MS = 86_400_000

const TRACKING_PARAMETERS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid'])

export function allowedResearchDomains(): string[] {
  return CURATED_RESEARCH_SOURCES.flatMap((source) => [...source.domains])
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return false
  const ipVersion = isIP(normalized)
  if (ipVersion === 4) {
    const [first = 0, second = 0] = normalized.split('.').map(Number)
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    )
  }
  if (ipVersion === 6) {
    return normalized !== '::' && normalized !== '::1' && !/^f[cd]/.test(normalized) && !/^fe[89ab]/.test(normalized)
  }
  return true
}

function parseResearchUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined
    if (!isPublicHostname(url.hostname)) return undefined
    return url
  } catch {
    return undefined
  }
}

export function isValidResearchUrl(value: string): boolean {
  return Boolean(parseResearchUrl(value))
}

export function researchSourceIdForUrl(value: string): string | undefined {
  const url = parseResearchUrl(value)
  if (!url) return undefined
  return CURATED_RESEARCH_SOURCES.find((source) =>
    source.domains.some((domain) => domainMatches(url.hostname.toLowerCase(), domain)),
  )?.id
}

export function canonicalResearchUrl(value: string): string | undefined {
  const url = parseResearchUrl(value)
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
