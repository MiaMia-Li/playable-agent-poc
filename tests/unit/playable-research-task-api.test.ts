import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createPlayableTaskHandlers, type PlayableTaskRepository } from '@/lib/playable/task-api'
import type { PlayableAgentAdapter } from '@/lib/playable/playable-agent-adapter'
import type { MarketResearchAgent } from '@/lib/playable/research/market-research-agent'
import type { MarketResearchReport, SearchBrief } from '@/lib/playable/research/schemas'

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
  focusAreas: ['前三秒'],
  requirementSummary: '搜索同类试玩',
}

const report: MarketResearchReport = {
  version: 1,
  runId: 'run-1',
  brief,
  strategyVersion: 'public-web-v1',
  generatedAt: '2026-09-10T01:00:00.000Z',
  industrySummary: {
    coreLoops: ['点击配对'],
    openingHooks: ['失败开场'],
    interactionPatterns: ['点击'],
    feedbackPatterns: ['即时消除'],
    ctaPatterns: ['结束后 CTA'],
    trends: [],
    saturationRisks: [],
    opportunities: [],
  },
  candidates: [
    {
      id: 'candidate-1',
      title: '公开案例',
      sourceUrl: 'https://ads.tiktok.com/example',
      sourceTitle: 'TikTok Creative Center',
      capturedAt: '2026-09-10T01:00:00.000Z',
      categoryTags: ['消除'],
      markets: ['全球'],
      coreLoop: '点击配对。',
      controls: '点击',
      openingHook: '失败开场。',
      stateChanges: ['完成消除'],
      feedback: '即时反馈。',
      cta: '结束后展示。',
      borrowableHighlights: ['失败开场'],
      excludedElements: ['品牌素材'],
      evidence: [
        {
          type: 'public_trend',
          label: '公开素材库出现',
          value: null,
          sourceUrl: 'https://ads.tiktok.com/example',
          sourceTitle: 'TikTok Creative Center',
          observedAt: '2026-09-10T01:00:00.000Z',
          strength: 'moderate',
        },
      ],
      confidence: 0.8,
      limitations: ['无内部指标'],
    },
  ],
  sourceCoverage: { sourceIds: ['tiktok-creative-center'], failedSourceIds: [] },
  warnings: ['公开趋势不能证明转化表现'],
}

it('streams and persists market research without changing task phase or brief', async () => {
  const updateRequirementBrief = vi.fn()
  const appendEvent = vi.fn(async () => undefined)
  const createResearchRun = vi.fn(async () => ({
    id: 'run-1',
    taskId: 'task-1',
    userId: 'user-1',
    status: 'confirmed' as const,
    trigger: brief.trigger,
    searchBrief: brief,
    cacheKey: 'cache',
    strategyVersion: 'public-web-v1',
    sourceIds: [],
    industrySummary: null,
    warnings: [],
    cachedFromRunId: null,
    errorCode: null,
    createdAt: new Date(),
    completedAt: null,
  }))
  const completeResearchRun = vi.fn(async () => report)
  const repository = {
    findOwnedTask: async () => ({
      id: 'task-1',
      userId: 'user-1',
      prompt: '搜索同类试玩',
      phase: 'draft' as const,
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }),
    listMessages: async () => [],
    listAssets: async () => [],
    findLatestVideoAnalysis: async () => undefined,
    listBuilds: async () => [],
    appendMessage: async () => undefined,
    updateRequirementBrief,
    appendEvent,
    createResearchRun,
    updateResearchRunStatus: async () => true,
    findReusableResearchReport: async () => undefined,
    completeResearchRun,
    failResearchRun: async () => undefined,
  } as unknown as PlayableTaskRepository
  const marketResearchAgent: MarketResearchAgent = {
    search: vi.fn(async (_input, options) => {
      for (const stage of ['searching', 'filtering', 'analyzing', 'summarizing'] as const) {
        options?.onProgress?.(stage)
      }
      return report
    }),
  }
  const agent: PlayableAgentAdapter = {
    proposeConfirmation: async (_input, options) => {
      const research = (await options?.executeTool?.({
        name: 'search_market_references',
        assetIds: [],
        assetId: null,
        searchBrief: brief,
      })) as MarketResearchReport
      return { kind: 'research', message: '研究完成。', reasoning: '等待采用。', research }
    },
    build: async () => {
      throw new Error('not used')
    },
    cancel: async () => undefined,
  }
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => 'user-1',
    readApiKey: async () => 'test-key',
    repository,
    agent,
    marketResearchAgent,
    artifactStore: { put: async () => undefined, get: async () => undefined, delete: async () => undefined },
    schedule: () => undefined,
    generateId: () => 'run-1',
  })

  const response = await handlers.message(
    new NextRequest('https://app.example/api/playable-tasks/task-1/messages', {
      method: 'POST',
      body: JSON.stringify({ message: '搜索同类试玩' }),
    }),
    { params: Promise.resolve({ taskId: 'task-1' }) },
  )
  const events = (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; stage?: string })

  expect(events.filter(({ type }) => type === 'research_progress').map(({ stage }) => stage)).toEqual([
    'searching',
    'filtering',
    'analyzing',
    'summarizing',
  ])
  expect(events.at(-1)?.type).toBe('research')
  expect(createResearchRun).toHaveBeenCalledOnce()
  expect(completeResearchRun).toHaveBeenCalledOnce()
  expect(updateRequirementBrief).not.toHaveBeenCalled()
  expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'research_completed' }))
})

it('resolves an adopted selection from persisted candidates before running the requirement agent', async () => {
  const resolvedSelection = {
    runId: report.runId,
    industrySummary: report.industrySummary,
    primaryCandidate: report.candidates[0],
    selectedHighlights: [{ candidate: report.candidates[0], value: '失败开场' }],
    customRequirements: '保留快速反馈',
    exclusions: ['品牌素材'],
  }
  const proposeConfirmation = vi.fn<PlayableAgentAdapter['proposeConfirmation']>(async () => ({
    kind: 'informational',
    message: '已采用该方向。',
    reasoning: '继续需求流程。',
  }))
  const saveReferenceSelection = vi.fn(async () => resolvedSelection)
  const repository = {
    findOwnedTask: async () => ({
      id: 'task-1',
      userId: 'user-1',
      prompt: '制作试玩',
      phase: 'draft' as const,
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }),
    listMessages: async () => [],
    listAssets: async () => [],
    findLatestVideoAnalysis: async () => undefined,
    listBuilds: async () => [],
    appendMessage: async () => undefined,
    updateRequirementBrief: async () => true,
    appendEvent: async () => undefined,
    saveReferenceSelection,
  } as unknown as PlayableTaskRepository
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => 'user-1',
    readApiKey: async () => 'test-key',
    repository,
    agent: {
      proposeConfirmation,
      build: async () => {
        throw new Error('not used')
      },
      cancel: async () => undefined,
    },
    artifactStore: { put: async () => undefined, get: async () => undefined, delete: async () => undefined },
    schedule: () => undefined,
    generateId: () => 'selection-1',
  })
  const selection = {
    runId: report.runId,
    primaryCandidateId: report.candidates[0].id,
    selectedHighlights: [{ candidateId: report.candidates[0].id, value: '失败开场' }],
    customRequirements: '保留快速反馈',
    exclusions: ['品牌素材'],
  }

  const response = await handlers.message(
    new NextRequest('https://app.example/api/playable-tasks/task-1/messages', {
      method: 'POST',
      body: JSON.stringify({ message: '采用此方向', referenceSelection: selection }),
    }),
    { params: Promise.resolve({ taskId: 'task-1' }) },
  )
  await response.text()

  expect(saveReferenceSelection).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: 'task-1', userId: 'user-1', selection }),
  )
  expect(proposeConfirmation).toHaveBeenCalledWith(
    expect.objectContaining({ referenceSelection: resolvedSelection }),
    expect.any(Object),
  )
})

it('rejects a selection that cannot be resolved against owned persisted candidates', async () => {
  const proposeConfirmation = vi.fn()
  const repository = {
    findOwnedTask: async () => ({
      id: 'task-1',
      userId: 'user-1',
      prompt: '制作试玩',
      phase: 'draft' as const,
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }),
    listAssets: async () => [],
    findOwnedAsset: async () => undefined,
    saveReferenceSelection: async () => undefined,
  } as unknown as PlayableTaskRepository
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => 'user-1',
    readApiKey: async () => 'test-key',
    repository,
    agent: {
      proposeConfirmation,
      build: async () => {
        throw new Error('not used')
      },
      cancel: async () => undefined,
    },
    artifactStore: { put: async () => undefined, get: async () => undefined, delete: async () => undefined },
    schedule: () => undefined,
    generateId: () => 'selection-1',
  })

  const response = await handlers.message(
    new NextRequest('https://app.example/api/playable-tasks/task-1/messages', {
      method: 'POST',
      body: JSON.stringify({
        message: '采用此方向',
        referenceSelection: {
          runId: 'other-run',
          primaryCandidateId: 'other-candidate',
          selectedHighlights: [],
          customRequirements: '',
          exclusions: [],
        },
      }),
    }),
    { params: Promise.resolve({ taskId: 'task-1' }) },
  )

  expect(response.status).toBe(400)
  expect(proposeConfirmation).not.toHaveBeenCalled()
})

it('records when the requirement agent offers optional market research', async () => {
  const appendEvent = vi.fn(async () => undefined)
  const repository = {
    findOwnedTask: async () => ({
      id: 'task-1',
      userId: 'user-1',
      prompt: '制作试玩',
      phase: 'draft' as const,
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }),
    listMessages: async () => [],
    listAssets: async () => [],
    findLatestVideoAnalysis: async () => undefined,
    listBuilds: async () => [],
    appendMessage: async () => undefined,
    updateRequirementBrief: async () => true,
    setDraft: async () => true,
    appendEvent,
  } as unknown as PlayableTaskRepository
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => 'user-1',
    readApiKey: async () => 'test-key',
    repository,
    agent: {
      proposeConfirmation: async () => ({
        kind: 'clarification',
        message: '是否先搜索同类案例？',
        reasoning: '市场参考可能有帮助。',
        options: [],
        tools: ['offer_market_research'],
      }),
      build: async () => {
        throw new Error('not used')
      },
      cancel: async () => undefined,
    },
    artifactStore: { put: async () => undefined, get: async () => undefined, delete: async () => undefined },
    schedule: () => undefined,
    generateId: () => 'unused',
  })

  const response = await handlers.message(
    new NextRequest('https://app.example/api/playable-tasks/task-1/messages', {
      method: 'POST',
      body: JSON.stringify({ message: '想做一个麻将配对试玩' }),
    }),
    { params: Promise.resolve({ taskId: 'task-1' }) },
  )
  await response.text()

  expect(appendEvent).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'research_suggested', message: 'Market research suggested' }),
  )
})

it('copies a matching cached report without invoking the external research agent', async () => {
  const completeResearchRun = vi.fn(async (_id, _taskId, value: MarketResearchReport) => ({
    ...value,
    runId: 'run-2',
  }))
  const repository = {
    findOwnedTask: async () => ({
      id: 'task-1',
      userId: 'user-1',
      prompt: '搜索同类试玩',
      phase: 'draft' as const,
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }),
    listMessages: async () => [],
    listAssets: async () => [],
    findLatestVideoAnalysis: async () => undefined,
    listBuilds: async () => [],
    appendMessage: async () => undefined,
    appendEvent: async () => undefined,
    createResearchRun: async () => ({}) as never,
    updateResearchRunStatus: async () => true,
    findReusableResearchReport: async () => report,
    completeResearchRun,
    failResearchRun: async () => undefined,
  } as unknown as PlayableTaskRepository
  const search = vi.fn<MarketResearchAgent['search']>()
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => 'user-1',
    readApiKey: async () => 'test-key',
    repository,
    agent: {
      proposeConfirmation: async (_input, options) => {
        const research = (await options?.executeTool?.({
          name: 'search_market_references',
          assetIds: [],
          assetId: null,
          searchBrief: brief,
        })) as MarketResearchReport
        return { kind: 'research', message: '研究完成。', reasoning: '使用缓存。', research }
      },
      build: async () => {
        throw new Error('not used')
      },
      cancel: async () => undefined,
    },
    marketResearchAgent: { search },
    artifactStore: { put: async () => undefined, get: async () => undefined, delete: async () => undefined },
    schedule: () => undefined,
    generateId: () => 'run-2',
  })

  const response = await handlers.message(
    new NextRequest('https://app.example/api/playable-tasks/task-1/messages', {
      method: 'POST',
      body: JSON.stringify({ message: '再搜索一次' }),
    }),
    { params: Promise.resolve({ taskId: 'task-1' }) },
  )
  await response.text()

  expect(search).not.toHaveBeenCalled()
  expect(completeResearchRun).toHaveBeenCalledWith(
    'run-2',
    'task-1',
    expect.objectContaining({ runId: 'run-2' }),
    'run-1',
  )
})

it('marks a failed research run and lets the requirement agent continue with clarification', async () => {
  const failResearchRun = vi.fn(async () => undefined)
  const repository = {
    findOwnedTask: async () => ({
      id: 'task-1',
      userId: 'user-1',
      prompt: '搜索同类试玩',
      phase: 'draft' as const,
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }),
    listMessages: async () => [],
    listAssets: async () => [],
    findLatestVideoAnalysis: async () => undefined,
    listBuilds: async () => [],
    appendMessage: async () => undefined,
    updateRequirementBrief: async () => true,
    setDraft: async () => true,
    appendEvent: async () => undefined,
    createResearchRun: async () => ({}) as never,
    updateResearchRunStatus: async () => true,
    findReusableResearchReport: async () => undefined,
    completeResearchRun: async () => report,
    failResearchRun,
  } as unknown as PlayableTaskRepository
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => 'user-1',
    readApiKey: async () => 'test-key',
    repository,
    agent: {
      proposeConfirmation: async (_input, options) => {
        const result = await options?.executeTool?.({
          name: 'search_market_references',
          assetIds: [],
          assetId: null,
          searchBrief: brief,
        })
        expect(result).toEqual({ status: 'unavailable', reason: 'research_unavailable' })
        return {
          kind: 'clarification',
          message: '暂时无法完成搜索，要继续整理需求吗？',
          reasoning: '搜索服务不可用。',
          options: [],
        }
      },
      build: async () => {
        throw new Error('not used')
      },
      cancel: async () => undefined,
    },
    marketResearchAgent: {
      search: async () => {
        throw new Error('provider unavailable')
      },
    },
    artifactStore: { put: async () => undefined, get: async () => undefined, delete: async () => undefined },
    schedule: () => undefined,
    generateId: () => 'run-1',
  })

  const response = await handlers.message(
    new NextRequest('https://app.example/api/playable-tasks/task-1/messages', {
      method: 'POST',
      body: JSON.stringify({ message: '搜索同类试玩' }),
    }),
    { params: Promise.resolve({ taskId: 'task-1' }) },
  )
  const events = (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string })

  expect(failResearchRun).toHaveBeenCalledWith('run-1', 'task-1', 'failed', 'unavailable')
  expect(events.at(-1)?.type).toBe('clarification')
})
