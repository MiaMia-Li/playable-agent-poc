import { describe, expect, it } from 'vitest'
import { restorePlayableConversation } from '@/lib/playable/conversation'
import type { ConfirmationProposal, RevisionProposal } from '@/lib/playable/schemas'
import type { PlayableBuildRecord } from '@/lib/playable/task-api'
import { LocalDemoMarketResearchAgent } from '@/lib/playable/research/local-demo-market-research-agent'

const confirmation: ConfirmationProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] },
  mode: 'center_collision',
  gameplay: '点击两张相同麻将牌后消除',
  resources: {
    tileFaces: { status: '内置默认', treatment: '默认牌面' },
    backgroundBoard: { status: '内置默认', treatment: '默认背景' },
    animationEffects: { status: '内置默认', treatment: '默认特效' },
    audio: { status: '内置默认', treatment: '默认音频' },
    endCard: { status: '内置默认', treatment: '默认结束卡' },
  },
  copy: { title: '试玩', cta: '下载', disclaimer: '演示', locale: 'zh-CN' },
  storeUrl: 'https://example.com/store',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

const pendingRevision: RevisionProposal = {
  id: 'revision-2',
  baseBuildId: 'build-1',
  baseVersion: 1,
  targetVersion: 2,
  strategy: 'patch',
  summary: '移除顶部标题',
  changes: ['移除标题'],
  preserved: ['玩法和素材'],
}

describe('playable conversation restoration', () => {
  it('restores every stored build table and resolves the latest pending revision after refresh', () => {
    const messages = [
      {
        id: 'message-1',
        taskId: 'task-1',
        role: 'agent' as const,
        content: JSON.stringify({
          kind: 'confirmation',
          message: '第一版方案',
          reasoning: '玩法明确',
          confirmation,
        }),
        createdAt: new Date(1),
      },
      {
        id: 'message-2',
        taskId: 'task-1',
        role: 'agent' as const,
        content: JSON.stringify({
          kind: 'revision',
          message: '第二版方案',
          reasoning: '修改明确',
          confirmation: { ...confirmation, gameplay: '跑酷战斗玩法' },
          revision: {
            strategy: 'patch',
            summary: '移除顶部标题',
            changes: ['移除标题'],
            preserved: ['玩法和素材'],
          },
        }),
        createdAt: new Date(2),
      },
    ]

    const restored = restorePlayableConversation(messages, pendingRevision)

    expect(restored).toHaveLength(2)
    expect(restored[0]).toMatchObject({ content: '第一版方案', confirmation })
    expect(restored[1]).toMatchObject({
      content: '第二版方案',
      confirmation: { gameplay: '跑酷战斗玩法' },
      revision: pendingRevision,
    })
  })

  it('restores the accepted edited confirmation from its persisted build after refresh', () => {
    const proposedConfirmation: ConfirmationProposal = {
      ...confirmation,
      resources: {
        ...confirmation.resources,
        tileFaces: { status: '待上传', treatment: '等待上传牌面' },
      },
    }
    const acceptedConfirmation: ConfirmationProposal = {
      ...confirmation,
      resources: {
        ...confirmation.resources,
        tileFaces: { status: '用户上传', treatment: 'historical-tiles.png' },
      },
    }
    const build: PlayableBuildRecord = {
      id: 'build-1',
      taskId: 'task-1',
      status: 'succeeded',
      confirmation: acceptedConfirmation,
      revision: null,
      artifactKey: 'tasks/task-1/builds/build-1/playable.html',
      createdAt: new Date(2),
      completedAt: new Date(3),
    }

    const restored = restorePlayableConversation(
      [
        {
          id: 'message-1',
          taskId: 'task-1',
          role: 'agent',
          content: JSON.stringify({
            kind: 'confirmation',
            message: '第一版方案',
            reasoning: '等待用户补充素材',
            confirmation: proposedConfirmation,
          }),
          createdAt: new Date(1),
        },
      ],
      null,
      [build],
    )

    expect(restored[0]?.confirmation?.resources.tileFaces).toEqual({
      status: '用户上传',
      treatment: 'historical-tiles.png',
    })
  })

  it('restores a research report with its persisted adoption and ignores malformed history', async () => {
    const report = await new LocalDemoMarketResearchAgent().search({
      runId: 'research-run-1',
      apiKey: 'test-key',
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
    })
    const selection = {
      runId: report.runId,
      primaryCandidateId: report.candidates[0].id,
      selectedHighlights: [],
      customRequirements: '',
      exclusions: [],
    }
    const restored = restorePlayableConversation(
      [
        {
          id: 'research-message',
          taskId: 'task-1',
          role: 'agent',
          content: JSON.stringify({
            kind: 'research',
            message: '研究完成。',
            reasoning: '等待采用。',
            research: report,
          }),
          createdAt: new Date(1),
        },
        {
          id: 'malformed-message',
          taskId: 'task-1',
          role: 'agent',
          content: '{"kind":"research","research":',
          createdAt: new Date(2),
        },
      ],
      null,
      [],
      [
        {
          id: 'selection-1',
          taskId: 'task-1',
          userId: 'user-1',
          runId: report.runId,
          selection,
          createdAt: new Date(3),
        },
      ],
    )

    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ content: '研究完成。', research: report, adoptedSelection: selection })
  })
})
