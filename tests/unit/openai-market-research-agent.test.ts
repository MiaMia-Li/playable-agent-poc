import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai7'
import { MarketResearchError, type MarketResearchProgressStage } from '@/lib/playable/research/market-research-agent'
import {
  OpenAIMarketResearchAgent,
  type MarketAnalysisResult,
  type MarketDiscoveryResult,
} from '@/lib/playable/research/openai-market-research-agent'
import type {
  MarketResearchCandidate,
  MarketResearchIndustrySummary,
  SearchBrief,
} from '@/lib/playable/research/schemas'

vi.mock('ai7', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai7')>()),
  generateText: vi.fn(),
}))

const brief: SearchBrief = {
  version: 1,
  trigger: 'explicit',
  category: '消除',
  subcategory: '麻将配对',
  gameplayKeywords: ['点击配对'],
  market: '全球',
  locale: 'zh-CN',
  adNetwork: 'AppLovin',
  timeRange: '最近 90 天',
  focusAreas: ['前三秒钩子'],
  requirementSummary: '寻找同类试玩广告',
}

const candidate: MarketResearchCandidate = {
  id: 'candidate-1',
  title: '牌架配对案例',
  sourceUrl: 'https://ads.tiktok.com/business/creativecenter/example',
  sourceTitle: 'TikTok Creative Center',
  capturedAt: '2026-09-10T01:00:00.000Z',
  categoryTags: ['消除'],
  markets: ['全球'],
  coreLoop: '点击相同目标并完成消除。',
  controls: '单指点击',
  openingHook: '开场展示即将失败的局面。',
  stateChanges: ['目标进入牌架', '相同目标消除'],
  feedback: '即时粒子和计分反馈。',
  cta: '结束后显示 CTA。',
  borrowableHighlights: ['接近失败的开场'],
  excludedElements: ['品牌和原始素材'],
  evidence: [
    {
      type: 'public_trend',
      label: '公开素材库重复出现',
      value: '近期多次出现',
      sourceUrl: 'https://ads.tiktok.com/business/creativecenter/example',
      sourceTitle: 'TikTok Creative Center',
      observedAt: '2026-09-10T01:00:00.000Z',
      strength: 'moderate',
    },
  ],
  confidence: 0.8,
  limitations: ['没有内部投放指标'],
}

const industrySummary: MarketResearchIndustrySummary = {
  coreLoops: ['点击并消除相同目标'],
  openingHooks: ['从接近失败的局面开始'],
  interactionPatterns: ['单指点击'],
  feedbackPatterns: ['即时粒子和计分'],
  ctaPatterns: ['完成后展示结束卡'],
  trends: ['短教程后立即交互'],
  saturationRisks: ['视觉同质化'],
  opportunities: ['强化失败恢复'],
}

function discovery(overrides: Partial<MarketDiscoveryResult> = {}): MarketDiscoveryResult {
  return {
    candidates: [candidate],
    providerSourceUrls: [candidate.sourceUrl],
    failedSourceIds: [],
    warnings: [],
    ...overrides,
  }
}

function analysis(overrides: Partial<MarketAnalysisResult> = {}): MarketAnalysisResult {
  return {
    industrySummary,
    candidates: [candidate],
    warnings: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.mocked(generateText).mockReset()
})

describe('OpenAIMarketResearchAgent', () => {
  it('accepts structured source URLs when the provider source list is empty', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        output: {
          candidates: [candidate],
          sourceUrls: [candidate.sourceUrl],
          warnings: [],
        },
        sources: [],
      } as never)
      .mockResolvedValueOnce({ output: analysis(), sources: [] } as never)

    const report = await new OpenAIMarketResearchAgent().search({
      runId: 'run-1',
      apiKey: 'test-key',
      brief,
    })

    expect(report.candidates).toHaveLength(1)
    expect(report.sourceCoverage.sourceIds).toEqual(['tiktok-creative-center'])
  })

  it('restricts discovery to registered domains', async () => {
    const discover = vi.fn(async () => discovery())
    const agent = new OpenAIMarketResearchAgent({ discover, analyze: async () => analysis() })

    await agent.search({ runId: 'run-1', apiKey: 'test-key', brief })

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedDomains: ['ads.tiktok.com', 'adstransparency.google.com', 'facebook.com', 'applovin.com', 'liftoff.io'],
      }),
    )
  })

  it('drops candidates not present in provider-returned sources', async () => {
    const ungrounded = {
      ...candidate,
      id: 'candidate-2',
      sourceUrl: 'https://www.applovin.com/blog/not-returned',
    }
    const agent = new OpenAIMarketResearchAgent({
      discover: async () => discovery({ candidates: [candidate, ungrounded] }),
      analyze: async ({ candidates }) => analysis({ candidates }),
    })

    const report = await agent.search({ runId: 'run-1', apiKey: 'test-key', brief })

    expect(report.candidates.map(({ id }) => id)).toEqual(['candidate-1'])
  })

  it('emits all progress stages in order', async () => {
    const stages: MarketResearchProgressStage[] = []
    const agent = new OpenAIMarketResearchAgent({
      discover: async () => discovery(),
      analyze: async () => analysis(),
    })

    await agent.search({ runId: 'run-1', apiKey: 'test-key', brief }, { onProgress: (stage) => stages.push(stage) })

    expect(stages).toEqual(['searching', 'filtering', 'analyzing', 'summarizing'])
  })

  it('gives discovery and deep analysis independent timeout signals', async () => {
    let discoverySignal: AbortSignal | undefined
    let analysisSignal: AbortSignal | undefined
    const agent = new OpenAIMarketResearchAgent({
      discover: async (input) => {
        discoverySignal = input.abortSignal
        return discovery()
      },
      analyze: async (input) => {
        analysisSignal = input.abortSignal
        return analysis()
      },
    })

    await agent.search({ runId: 'run-1', apiKey: 'test-key', brief })

    expect(discoverySignal).toBeDefined()
    expect(analysisSignal).toBeDefined()
    expect(analysisSignal).not.toBe(discoverySignal)
  })

  it('preserves explicit evidence types', async () => {
    const thirdPartyCandidate: MarketResearchCandidate = {
      ...candidate,
      evidence: [{ ...candidate.evidence[0], type: 'third_party_estimate', label: '第三方热度估算' }],
    }
    const agent = new OpenAIMarketResearchAgent({
      discover: async () => discovery({ candidates: [thirdPartyCandidate] }),
      analyze: async () => analysis({ candidates: [thirdPartyCandidate] }),
    })

    const report = await agent.search({ runId: 'run-1', apiKey: 'test-key', brief })

    expect(report.candidates[0]?.evidence[0]?.type).toBe('third_party_estimate')
  })

  it('returns grounded discovery candidates when deep analysis times out', async () => {
    const agent = new OpenAIMarketResearchAgent({
      discover: async () => discovery(),
      analyze: async () => {
        throw new MarketResearchError('timeout')
      },
    })

    const report = await agent.search({ runId: 'run-1', apiKey: 'test-key', brief })

    expect(report.candidates).toHaveLength(1)
    expect(report.candidates[0]?.confidence).toBeLessThan(candidate.confidence)
    expect(report.warnings).toContain('深度分析超时，已返回可验证的初步结果')
  })

  it('throws unavailable when no reliable candidates remain', async () => {
    const agent = new OpenAIMarketResearchAgent({
      discover: async () => discovery({ providerSourceUrls: [] }),
      analyze: async () => analysis(),
    })

    await expect(agent.search({ runId: 'run-1', apiKey: 'test-key', brief })).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('honors an already-aborted caller signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const discover = vi.fn(async () => discovery())
    const agent = new OpenAIMarketResearchAgent({ discover, analyze: async () => analysis() })

    await expect(
      agent.search({ runId: 'run-1', apiKey: 'test-key', brief }, { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(discover).not.toHaveBeenCalled()
  })
})
