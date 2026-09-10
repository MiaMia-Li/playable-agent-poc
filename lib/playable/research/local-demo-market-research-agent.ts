import type { MarketResearchAgent } from './market-research-agent'
import { marketResearchReportSchema } from './schemas'
import { MARKET_RESEARCH_STRATEGY_VERSION } from './source-registry'

export class LocalDemoMarketResearchAgent implements MarketResearchAgent {
  async search(
    input: Parameters<MarketResearchAgent['search']>[0],
    options?: Parameters<MarketResearchAgent['search']>[1],
  ) {
    for (const stage of ['searching', 'filtering', 'analyzing', 'summarizing'] as const) {
      options?.onProgress?.(stage)
    }
    const sourceUrl = 'https://ads.tiktok.com/business/creativecenter/demo'
    const generatedAt = '2026-09-10T00:00:00.000Z'
    const candidates = ['失败局面开场', '一步教学开场', '奖励目标开场'].map((openingHook, index) => ({
      id: `demo-candidate-${index + 1}`,
      title: `${input.brief.category}公开案例 ${index + 1}`,
      sourceUrl,
      sourceTitle: 'TikTok Creative Center',
      capturedAt: generatedAt,
      categoryTags: [input.brief.category],
      markets: [input.brief.market],
      coreLoop: `围绕${input.brief.gameplayKeywords.join('、')}完成一次短循环。`,
      controls: '单指点击',
      openingHook,
      stateChanges: ['开始交互', '完成目标', '展示结果'],
      feedback: '操作后立即提供视觉与分数反馈。',
      cta: '完成核心循环后展示 CTA。',
      borrowableHighlights: [openingHook, '即时操作反馈'],
      excludedElements: ['品牌、原始素材和原文案'],
      evidence: [
        {
          type: 'public_trend' as const,
          label: '本地演示公开趋势样例',
          value: null,
          sourceUrl,
          sourceTitle: 'TikTok Creative Center',
          observedAt: generatedAt,
          strength: 'moderate' as const,
        },
      ],
      confidence: 0.72,
      limitations: ['本地演示使用固定数据，不代表实时市场表现'],
    }))
    return marketResearchReportSchema.parse({
      version: 1,
      runId: input.runId,
      brief: input.brief,
      strategyVersion: MARKET_RESEARCH_STRATEGY_VERSION,
      generatedAt,
      industrySummary: {
        coreLoops: candidates.map((candidate) => candidate.coreLoop),
        openingHooks: candidates.map((candidate) => candidate.openingHook),
        interactionPatterns: ['单指点击'],
        feedbackPatterns: ['即时视觉反馈'],
        ctaPatterns: ['核心循环后展示 CTA'],
        trends: ['更快进入第一次交互'],
        saturationRisks: ['常见开场容易同质化'],
        opportunities: ['结合明确目标与失败恢复'],
      },
      candidates,
      sourceCoverage: { sourceIds: ['tiktok-creative-center'], failedSourceIds: [] },
      warnings: ['公开趋势不能证明真实转化表现'],
    })
  }
}
