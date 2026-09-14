import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIMarketResearchAgent } from '@/lib/playable/research/openai-market-research-agent'
import type {
  MarketResearchCandidate,
  MarketResearchIndustrySummary,
  SearchBrief,
} from '@/lib/playable/research/schemas'

vi.mock('@/lib/playable/external-request-logging', () => ({
  logExternalRequestError: vi.fn(),
}))

const brief: SearchBrief = {
  version: 1,
  trigger: 'explicit',
  category: '抽奖',
  subcategory: '幸运转盘',
  gameplayKeywords: ['点击抽奖'],
  market: '全球',
  locale: 'zh-CN',
  adNetwork: 'AppLovin',
  timeRange: '最近 90 天',
  focusAreas: ['前三秒钩子'],
  requirementSummary: '寻找抽奖类试玩广告案例',
}

const sourceUrl = 'https://ads.tiktok.com/business/creativecenter/example'

const candidate: MarketResearchCandidate = {
  id: 'candidate-1',
  title: '幸运转盘案例',
  sourceUrl,
  sourceTitle: 'TikTok Creative Center',
  capturedAt: '2026-09-14T00:00:00.000Z',
  categoryTags: ['抽奖'],
  markets: ['全球'],
  coreLoop: '点击转盘并领取奖励。',
  controls: '单指点击',
  openingHook: '开场立即展示大奖。',
  stateChanges: ['转盘开始旋转', '指针停在奖励区'],
  feedback: '粒子特效和奖励弹窗。',
  cta: '领奖后展示 CTA。',
  borrowableHighlights: ['首屏展示稀有大奖'],
  excludedElements: ['品牌和原始美术'],
  evidence: [
    {
      type: 'public_trend',
      label: '公开素材库可观察玩法',
      value: '转盘交互',
      sourceUrl,
      sourceTitle: 'TikTok Creative Center',
      observedAt: '2026-09-14T00:00:00.000Z',
      strength: 'moderate',
    },
  ],
  confidence: 0.8,
  limitations: ['不包含内部投放指标'],
}

const industrySummary: MarketResearchIndustrySummary = {
  coreLoops: [candidate.coreLoop],
  openingHooks: [candidate.openingHook],
  interactionPatterns: [candidate.controls],
  feedbackPatterns: [candidate.feedback],
  ctaPatterns: [candidate.cta],
  trends: [],
  saturationRisks: [],
  opportunities: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenRouter market research request', () => {
  it('uses the OpenRouter web-search tool without unsupported Responses include values', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({
          id: 'response-1',
          model: 'openai/gpt-5.6-sol',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({ candidates: [candidate], sourceUrls: [sourceUrl], warnings: [] }),
                annotations: [
                  {
                    type: 'url_citation',
                    url_citation: {
                      url: sourceUrl,
                      title: candidate.sourceTitle,
                      content: candidate.coreLoop,
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        })
      }),
    )

    const report = await new OpenAIMarketResearchAgent({
      analyze: async ({ candidates }) => ({ industrySummary, candidates, warnings: [] }),
      now: () => new Date('2026-09-14T01:00:00.000Z'),
    }).search({
      runId: 'run-request-shape',
      apiKey: 'test-key',
      brief,
    })

    expect(report.candidates).toEqual([candidate])
    expect(report.sourceCoverage.sourceIds).toEqual(['tiktok-creative-center'])
    expect(requestUrl).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(requestBody).toMatchObject({
      tools: [
        expect.objectContaining({
          type: 'openrouter:web_search',
          engine: 'auto',
          max_results: 8,
        }),
      ],
      tool_choice: 'auto',
    })
    expect(requestBody?.tools).toEqual([expect.not.objectContaining({ search_prompt: expect.anything() })])
    expect(requestBody).not.toHaveProperty('include')
    expect(JSON.stringify(requestBody)).not.toContain('web_search_call.action.sources')
  })
})
