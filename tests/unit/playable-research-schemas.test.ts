import { describe, expect, it } from 'vitest'
import {
  marketResearchReportSchema,
  referenceSelectionInputSchema,
  researchEvidenceSchema,
} from '@/lib/playable/research/schemas'
import { playableAgentReplySchema } from '@/lib/playable/schemas'

const searchBrief = {
  version: 1 as const,
  trigger: 'explicit' as const,
  category: '消除',
  subcategory: '麻将配对',
  gameplayKeywords: ['点击配对', '牌架'],
  market: '全球',
  locale: 'zh-CN',
  adNetwork: 'AppLovin',
  timeRange: '最近 90 天',
  focusAreas: ['前三秒钩子', '失败反馈'],
  requirementSummary: '制作一个麻将配对试玩广告',
}

const industrySummary = {
  coreLoops: ['点击可见牌并完成配对'],
  openingHooks: ['开场直接展示即将失败的局面'],
  interactionPatterns: ['单指点击'],
  feedbackPatterns: ['配对成功后立即消除并计分'],
  ctaPatterns: ['完成一局后展示结束卡'],
  trends: ['短教程后立即进入核心操作'],
  saturationRisks: ['同类牌面和棋盘视觉高度相似'],
  opportunities: ['通过失败恢复机制降低挫败感'],
}

const candidate = {
  id: 'candidate-1',
  title: '麻将牌架配对案例',
  sourceUrl: 'https://ads.tiktok.com/business/creativecenter/example',
  sourceTitle: 'TikTok Creative Center',
  capturedAt: '2026-09-10T01:00:00.000Z',
  categoryTags: ['消除', '麻将'],
  markets: ['全球'],
  coreLoop: '点击可见麻将牌，将相同牌放入牌架并消除。',
  controls: '单指点击',
  openingHook: '牌架接近填满，玩家必须立刻完成配对。',
  stateChanges: ['选中牌进入牌架', '相同牌消除', '牌架填满后失败'],
  feedback: '成功时播放粒子和分数反馈。',
  cta: '完成挑战后展示试玩 CTA。',
  borrowableHighlights: ['接近失败的开场局面', '配对后的即时粒子反馈'],
  excludedElements: ['品牌角色', '原始牌面素材', '原文案'],
  evidence: [
    {
      type: 'public_trend' as const,
      label: '公开素材库重复出现',
      value: '近 30 天多次出现',
      sourceUrl: 'https://ads.tiktok.com/business/creativecenter/example',
      sourceTitle: 'TikTok Creative Center',
      observedAt: '2026-09-10T01:00:00.000Z',
      strength: 'moderate' as const,
    },
  ],
  confidence: 0.82,
  limitations: ['公开页面未提供真实转化指标'],
}

const report = {
  version: 1 as const,
  runId: 'run-1',
  brief: searchBrief,
  strategyVersion: 'public-web-v1',
  generatedAt: '2026-09-10T01:02:00.000Z',
  industrySummary,
  candidates: [
    candidate,
    { ...candidate, id: 'candidate-2', title: '重力下落配对案例' },
    { ...candidate, id: 'candidate-3', title: '中心碰撞配对案例' },
  ],
  sourceCoverage: {
    sourceIds: ['tiktok-creative-center'],
    failedSourceIds: [],
  },
  warnings: ['公开趋势不能证明真实转化表现'],
}

describe('playable market research schemas', () => {
  it('accepts a public-evidence report with three candidates', () => {
    expect(marketResearchReportSchema.parse(report)).toEqual(report)
  })

  it('rejects conversion-performance language on public trend evidence', () => {
    expect(
      researchEvidenceSchema.safeParse({
        ...candidate.evidence[0],
        label: 'ROAS 表现优秀',
      }).success,
    ).toBe(false)
  })

  it('rejects non-HTTPS source URLs and more than five candidates', () => {
    expect(
      marketResearchReportSchema.safeParse({
        ...report,
        candidates: [{ ...candidate, sourceUrl: 'http://ads.tiktok.com/example' }],
      }).success,
    ).toBe(false)
    expect(
      marketResearchReportSchema.safeParse({
        ...report,
        candidates: Array.from({ length: 6 }, (_, index) => ({ ...candidate, id: `candidate-${index}` })),
      }).success,
    ).toBe(false)
  })

  it('accepts summary-only adoption without a primary candidate', () => {
    expect(
      referenceSelectionInputSchema.parse({
        runId: 'run-1',
        primaryCandidateId: null,
        selectedHighlights: [],
        customRequirements: '只采用行业总结',
        exclusions: [],
      }),
    ).toMatchObject({ runId: 'run-1', primaryCandidateId: null })
  })

  it('rejects duplicate highlight selections', () => {
    expect(
      referenceSelectionInputSchema.safeParse({
        runId: 'run-1',
        primaryCandidateId: 'candidate-1',
        selectedHighlights: [
          { candidateId: 'candidate-2', value: '即时反馈' },
          { candidateId: 'candidate-2', value: '即时反馈' },
        ],
        customRequirements: '',
        exclusions: [],
      }).success,
    ).toBe(false)
  })

  it('parses a research Agent reply without a Requirement Brief update', () => {
    const parsed = playableAgentReplySchema.parse({
      kind: 'research',
      message: '请选择参考方向。',
      reasoning: '研究结果采用后才进入需求。',
      research: report,
    })

    expect(parsed.kind).toBe('research')
    expect('brief' in parsed).toBe(false)
  })
})
