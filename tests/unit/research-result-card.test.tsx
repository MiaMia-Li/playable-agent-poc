// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResearchResultCard } from '@/components/playable/research-result-card'
import type { MarketResearchReport } from '@/lib/playable/research/schemas'

const report: MarketResearchReport = {
  version: 1,
  runId: 'run-1',
  brief: {
    version: 1,
    trigger: 'explicit',
    category: '消除',
    subcategory: '麻将配对',
    gameplayKeywords: ['点击配对'],
    market: '全球',
    locale: 'zh-CN',
    adNetwork: 'AppLovin',
    timeRange: '最近 90 天',
    focusAreas: ['前三秒'],
    requirementSummary: '搜索同类试玩',
  },
  strategyVersion: 'public-web-v1',
  generatedAt: '2026-09-10T01:00:00.000Z',
  industrySummary: {
    coreLoops: ['点击配对'],
    openingHooks: ['失败局面', '一步教学', '奖励目标'],
    interactionPatterns: ['点击'],
    feedbackPatterns: ['即时消除'],
    ctaPatterns: ['结算后 CTA'],
    trends: ['更快进入交互'],
    saturationRisks: ['失败开场同质化'],
    opportunities: ['加入恢复反馈'],
  },
  candidates: ['失败局面', '一步教学', '奖励目标'].map((openingHook, index) => ({
    id: `candidate-${index + 1}`,
    title: `公开案例 ${index + 1}`,
    sourceUrl: `https://ads.tiktok.com/example-${index + 1}`,
    sourceTitle: 'TikTok Creative Center',
    capturedAt: '2026-09-10T01:00:00.000Z',
    categoryTags: ['消除'],
    markets: ['全球'],
    coreLoop: '点击两张同牌完成配对。',
    controls: '点击',
    openingHook,
    stateChanges: ['完成配对'],
    feedback: '即时消除。',
    cta: '结算后展示。',
    borrowableHighlights: [openingHook, '即时消除反馈'],
    excludedElements: ['品牌素材'],
    evidence: [
      {
        type: 'public_trend' as const,
        label: '公开素材库可见',
        value: null,
        sourceUrl: `https://ads.tiktok.com/example-${index + 1}`,
        sourceTitle: 'TikTok Creative Center',
        observedAt: '2026-09-10T01:00:00.000Z',
        strength: 'moderate' as const,
      },
    ],
    confidence: 0.75,
    limitations: ['无内部转化指标'],
  })),
  sourceCoverage: { sourceIds: ['tiktok-creative-center'], failedSourceIds: [] },
  warnings: ['公开趋势不能证明真实转化表现'],
}

afterEach(cleanup)

describe('ResearchResultCard', () => {
  it('submits one primary candidate plus highlights selected from other candidates', async () => {
    const onAdopt = vi.fn(async () => undefined)
    render(
      <ResearchResultCard
        report={report}
        disabled={false}
        onAdopt={onAdopt}
        onSearchAgain={vi.fn()}
        onSkip={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '市场参考分析' })).toHaveTextContent('3 个可参考方向')
    const candidates = screen.getAllByRole('article')
    fireEvent.click(within(candidates[1]).getByRole('radio'))
    fireEvent.click(within(candidates[2]).getByRole('checkbox', { name: '奖励目标' }))
    fireEvent.click(screen.getByRole('button', { name: '采用此方向' }))

    await waitFor(() =>
      expect(onAdopt).toHaveBeenCalledWith({
        runId: 'run-1',
        primaryCandidateId: 'candidate-2',
        selectedHighlights: [{ candidateId: 'candidate-3', value: '奖励目标' }],
        customRequirements: '',
        exclusions: [],
      }),
    )
  })

  it('supports summary-only adoption and collapses an adopted report to read-only state', async () => {
    const onAdopt = vi.fn(async () => undefined)
    const { rerender } = render(
      <ResearchResultCard
        report={report}
        disabled={false}
        onAdopt={onAdopt}
        onSearchAgain={vi.fn()}
        onSkip={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '仅采用行业总结' }))
    await waitFor(() =>
      expect(onAdopt).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-1', primaryCandidateId: null, selectedHighlights: [] }),
      ),
    )

    rerender(
      <ResearchResultCard
        report={report}
        adoptedSelection={{
          runId: 'run-1',
          primaryCandidateId: 'candidate-1',
          selectedHighlights: [],
          customRequirements: '',
          exclusions: [],
        }}
        disabled={false}
        onAdopt={onAdopt}
        onSearchAgain={vi.fn()}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getByText('已采用：公开案例 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采用此方向' })).not.toBeInTheDocument()
  })
})
