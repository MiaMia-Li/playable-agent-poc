// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationProposal, RequirementBrief, RevisionProposal } from '@/lib/playable/schemas'
import { ChatWorkspace } from '@/components/playable/chat-workspace'
import { ConfirmationTable } from '@/components/playable/confirmation-table'
import { PlayablePreview } from '@/components/playable/playable-preview'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'
import { deliveryProfileSnapshot } from '@/lib/playable/delivery-standards'
import { LocalDemoMarketResearchAgent } from '@/lib/playable/research/local-demo-market-research-agent'

Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })

const proposal: ConfirmationProposal = {
  routing: { match: 'approximate', confidence: 0.8, differences: ['奖励表现使用模板默认效果'] },
  mode: 'top_rack',
  gameplay: '相同牌进入牌架后消除',
  resources: {
    tileFaces: { status: '待上传', treatment: '上传牌面' },
    backgroundBoard: { status: '内置默认', treatment: '默认背景' },
    animationEffects: { status: '内置默认', treatment: '默认特效' },
    audio: { status: '待上传', treatment: '上传音频' },
    endCard: { status: '内置默认', treatment: '默认结束卡' },
  },
  copy: { title: '试玩', cta: '下载', disclaimer: '演示', locale: 'zh-CN' },
  storeUrl: 'http://example.com',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

const revision: RevisionProposal = {
  id: 'revision-2',
  baseBuildId: 'build-1',
  baseVersion: 1,
  targetVersion: 2,
  strategy: 'patch',
  summary: '移除顶部进度标题',
  changes: ['移除顶部“下落补位 0/4”标题'],
  preserved: ['核心玩法', '牌面素材', '结束卡'],
}

const blueprint = {
  version: 1 as const,
  summary: '点击配对',
  orientation: 'portrait' as const,
  controls: [],
  sceneStructure: { value: '棋盘', confidence: 1, evidence: [] },
  entities: [],
  coreLoop: { value: '配对', confidence: 1, evidence: [] },
  stateTransitions: [],
  objective: { value: '清空', confidence: 1, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  visualStyle: '卡通',
  uncertainties: [],
  overallConfidence: 1,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlayableWorkspace', () => {
  it('does not expose shared AI credential controls to public users', () => {
    render(<PlayableWorkspace taskId="task-7" publicAccess />)

    expect(screen.getByText('公开体验')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '配置 OpenAI API Key' })).not.toBeInTheDocument()
    expect(screen.queryByText(/自备 API Key/)).not.toBeInTheDocument()
  })

  it('starts the first conversation automatically after the API key is available', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/messages')) {
        return new Response(
          `${JSON.stringify({
            type: 'clarification',
            message: '请选择一种玩法。',
            reasoning: '目前只有视觉主题。',
            options: [{ id: 'center', label: '中心碰撞', description: '碰撞消除', value: '选择中心碰撞玩法' }],
          })}\n`,
        )
      }
      return Response.json({
        task: { phase: 'draft', hasArtifact: false, artifactVersion: null, confirmation: null },
        events: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured initialPrompt="制作农场主题试玩" />)

    expect(await screen.findByText('请选择一种玩法。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-7/messages',
      expect.objectContaining({ body: JSON.stringify({ message: '制作农场主题试玩' }) }),
    )
  })

  it('renders a persisted brief and dynamic multi-select request', () => {
    const brief: RequirementBrief = {
      version: 1,
      summary: '夏日清爽麻将消除，并增加奖励表现',
      gameplay: { concept: '麻将消除', coreLoop: '配对消除', controls: '点击', objective: '清空牌面' },
      experience: { visualTheme: '夏日清爽', tone: '轻松', camera: '竖屏' },
      assets: { images: 'unknown', audio: 'unknown' },
      launch: { title: '', cta: '', locale: 'zh-CN', storeUrl: '' },
      constraints: [],
      openQuestions: ['选择体验重点'],
      routing: {
        match: 'approximate',
        mode: 'center_collision',
        confidence: 0.7,
        differences: ['需要增加奖励表现'],
      },
    }
    const options = [
      { id: 'pace', label: '节奏', description: '快速反馈', value: '重视节奏' },
      { id: 'visual', label: '画面', description: '丰富表现', value: '重视画面' },
    ]
    render(
      <ChatWorkspace
        taskId="task-tools"
        phase="draft"
        brief={brief}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
        initialConversation={[
          {
            id: 'agent-1',
            role: 'assistant',
            content: '请选择体验重点。',
            reasoning: '这会影响部分匹配的实现。',
            status: 'sent',
            options,
            request: { type: 'multi_select', question: '哪些体验最重要？', options, allowCustom: true },
          },
        ]}
      />,
    )

    expect(screen.getByRole('region', { name: '需求 Brief' })).toHaveTextContent('部分匹配')
    expect(screen.getByRole('region', { name: '需求 Brief' })).toHaveTextContent('选择体验重点')
    const submit = screen.getByRole('button', { name: '确认选择' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /节奏/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /画面/ }))
    expect(submit).toBeEnabled()
  })

  it('shows reference tool started and failed states before a brief exists', async () => {
    const onVideoAnalysisToolStatus = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            [
              JSON.stringify({ type: 'tool_started', tool: 'inspect_reference_images' }),
              JSON.stringify({ type: 'tool_failed', tool: 'inspect_reference_images' }),
              JSON.stringify({ type: 'tool_started', tool: 'analyze_reference_video' }),
              JSON.stringify({ type: 'tool_failed', tool: 'analyze_reference_video' }),
              JSON.stringify({ type: 'informational', message: '工具暂不可用' }),
            ].join('\n'),
          ),
      ),
    )
    render(
      <ChatWorkspace
        taskId="task-tools"
        phase="draft"
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
        onVideoAnalysisToolStatus={onVideoAnalysisToolStatus}
      />,
    )

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '分析附件' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    const tools = await screen.findByRole('region', { name: '本轮 Agent 工具' })
    expect(tools).toHaveTextContent('分析参考图片失败')
    expect(tools).toHaveTextContent('分析参考视频失败')
    expect(onVideoAnalysisToolStatus).toHaveBeenNthCalledWith(1, 'started')
    expect(onVideoAnalysisToolStatus).toHaveBeenNthCalledWith(2, 'failed')
  })

  it('renders research progress and adopts persisted candidate IDs through the existing message flow', async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          [
            JSON.stringify({ type: 'research_progress', stage: 'searching', message: '正在检索公开来源' }),
            JSON.stringify({ type: 'research_progress', stage: 'analyzing', message: '正在分析玩法' }),
            JSON.stringify({ type: 'research', message: '研究完成。', reasoning: '等待采用。', research: report }),
          ].join('\n'),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `${JSON.stringify({
            type: 'clarification',
            message: '已采用参考方向，请选择核心玩法。',
            reasoning: '研究选择已进入需求上下文。',
            options: [],
          })}\n`,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-research"
        phase="draft"
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '搜索麻将配对试玩广告' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    const card = await screen.findByRole('region', { name: '市场参考分析' })
    expect(card).toHaveTextContent('3 个可参考方向')
    fireEvent.click(within(card).getAllByRole('radio')[0])
    fireEvent.click(within(card).getByRole('button', { name: '采用此方向' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/playable-tasks/task-research/messages',
        expect.objectContaining({
          body: JSON.stringify({
            message: '采用此方向',
            referenceSelection: {
              runId: 'research-run-1',
              primaryCandidateId: 'demo-candidate-1',
              selectedHighlights: [],
              customRequirements: '',
              exclusions: [],
            },
          }),
        }),
      ),
    )
    expect(await screen.findByText('已采用参考方向，请选择核心玩法。')).toBeInTheDocument()
  })

  it('refreshes QDAI analysis immediately when the video tool completes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/messages')) {
        return new Response(
          [
            JSON.stringify({ type: 'tool_started', tool: 'analyze_reference_video' }),
            JSON.stringify({ type: 'tool_completed', tool: 'analyze_reference_video' }),
            JSON.stringify({ type: 'informational', message: '视频已分析' }),
          ].join('\n'),
        )
      }
      if (String(input).endsWith('/analysis')) {
        return Response.json({ analysis: { status: 'succeeded', blueprint: { ...blueprint, summary: '即时蓝图' } } })
      }
      return Response.json({ builds: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayableWorkspace taskId="task-video-tool" initialApiKeyConfigured />)

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '分析视频' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(await screen.findByRole('region', { name: '参考视频分析' })).toHaveTextContent('即时蓝图')
    expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-video-tool/analysis', { cache: 'no-store' })
  })

  it('renders chat, upload, confirmation, progress, and preview controls', () => {
    render(<PlayableWorkspace taskId="task-7" initialApiKeyConfigured />)

    expect(screen.getByRole('region', { name: '需求对话' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '确认方案' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent('方案生成中可试玩')
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '竖屏预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '横屏预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消静音预览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '下载试玩' })).toBeDisabled()
  })

  it('keeps the first-build confirmation action visible above the composer', () => {
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={{
          ...proposal,
          storeUrl: 'https://example.com/store',
          resources: {
            ...proposal.resources,
            tileFaces: { status: '内置默认', treatment: '默认牌面' },
            audio: { status: '内置默认', treatment: '默认音频' },
          },
        }}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '待确认操作' })).toHaveTextContent('最新方案待确认')
    expect(screen.getByRole('button', { name: '确认方案并开始构建' })).toBeEnabled()
  })

  it('keeps the latest revision table interactive and submits its complete edited configuration', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const readyProposal = {
      ...proposal,
      storeUrl: 'https://example.com/store',
      resources: {
        ...proposal.resources,
        tileFaces: { status: '内置默认' as const, treatment: '默认牌面' },
        audio: { status: '内置默认' as const, treatment: '默认音频' },
      },
    }
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_revision_confirmation"
        proposal={readyProposal}
        revision={revision}
        hasArtifact
        initialConversation={[
          {
            id: 'agent-v2',
            role: 'assistant',
            content: '修改方案已经整理完成。',
            status: 'sent',
            confirmation: readyProposal,
            revision,
          },
        ]}
        onProposal={vi.fn()}
        onRevision={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '确认方案' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '修改计划' })).toHaveTextContent('基于 v1')
    expect(screen.getByRole('region', { name: '修改计划' })).toHaveTextContent('移除顶部进度标题')
    expect(screen.getByLabelText('玩法说明')).toBeEnabled()
    expect(screen.queryByRole('button', { name: '查看方案' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认修改并生成 v2' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/playable-tasks/task-7/confirm',
        expect.objectContaining({ body: JSON.stringify({ revisionId: 'revision-2', confirmation: readyProposal }) }),
      ),
    )
  })

  it('lets the latest revision proposal upload into the same resource slots as v1', async () => {
    const onProposal = vi.fn()
    const readyProposal = {
      ...proposal,
      storeUrl: 'https://example.com/store',
      resources: {
        ...proposal.resources,
        tileFaces: { status: '内置默认' as const, treatment: '默认牌面' },
        audio: { status: '内置默认' as const, treatment: '默认音频' },
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          asset: { id: 'asset-v2', slot: 'tileFaces', filename: 'v2-tiles.png', mimeType: 'image/png', size: 5 },
        }),
      ),
    )
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_revision_confirmation"
        proposal={readyProposal}
        revision={revision}
        hasArtifact
        initialConversation={[
          {
            id: 'agent-v2',
            role: 'assistant',
            content: '修改方案已经整理完成。',
            status: 'sent',
            confirmation: readyProposal,
            revision,
          },
        ]}
        onProposal={onProposal}
        onRevision={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('为牌面素材上传素材'), {
      target: { files: [new File(['image'], 'v2-tiles.png', { type: 'image/png' })] },
    })

    await waitFor(() =>
      expect(onProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          resources: expect.objectContaining({
            tileFaces: { status: '用户上传', treatment: 'v2-tiles.png' },
          }),
        }),
      ),
    )
  })

  it('keeps every agent build proposal in its original conversation position', () => {
    const firstProposal = {
      ...proposal,
      gameplay: '第一版麻将配对玩法',
      storeUrl: 'https://example.com/store',
      resources: {
        ...proposal.resources,
        tileFaces: { status: '用户上传' as const, treatment: 'historical-tiles.png' },
      },
    }
    const secondProposal = {
      ...proposal,
      gameplay: '第二版跑酷战斗玩法',
      storeUrl: 'https://example.com/store',
    }

    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_revision_confirmation"
        proposal={secondProposal}
        revision={revision}
        hasArtifact
        initialAssets={[
          {
            id: 'historical-tile-asset',
            slot: 'tileFaces',
            filename: 'historical-tiles.png',
            mimeType: 'image/png',
            size: 5,
          },
        ]}
        initialConversation={[
          {
            id: 'agent-v1',
            role: 'assistant',
            content: '第一版方案已经整理完成。',
            status: 'sent',
            confirmation: firstProposal,
          },
          {
            id: 'user-v2',
            role: 'user',
            content: '改成跑酷战斗玩法',
            status: 'sent',
          },
          {
            id: 'agent-v2',
            role: 'assistant',
            content: '第二版修改方案已经整理完成。',
            status: 'sent',
            confirmation: secondProposal,
            revision,
          },
        ]}
        onProposal={vi.fn()}
        onRevision={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    const replies = screen.getAllByRole('article', { name: '助手回复' })
    const historySummary = within(replies[0]).getByText('历史构建方案')
    const historyDetails = historySummary.closest('details')

    expect(historyDetails).not.toBeNull()
    expect(historyDetails).not.toHaveAttribute('open')

    fireEvent.click(historySummary)

    expect(historyDetails).toHaveAttribute('open')
    expect(within(replies[0]).getByRole('region', { name: '确认方案' })).toHaveTextContent('第一版麻将配对玩法')
    expect(within(replies[0]).getByRole('img', { name: 'historical-tiles.png' })).toBeInTheDocument()
    expect(within(replies[1]).getByRole('region', { name: '确认方案' })).toHaveTextContent('第二版跑酷战斗玩法')
    expect(within(replies[0]).getByLabelText('玩法说明')).toBeDisabled()
    expect(within(replies[1]).getByLabelText('玩法说明')).toBeEnabled()
  })

  it('shows compact progress on the confirmation button while Codex builds', () => {
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={vi.fn()}
        onConfirm={vi.fn()}
        buildPhase="building"
      />,
    )

    expect(screen.getByRole('button', { name: 'Codex 正在构建试玩…' })).toBeDisabled()
  })

  it('renders exact mode ID and label and enforces pending-upload and HTTPS gates', () => {
    const onChange = vi.fn()
    render(<ConfirmationTable proposal={proposal} onChange={onChange} onConfirm={vi.fn()} />)

    expect(screen.getByText('top_rack')).toBeInTheDocument()
    expect(screen.getByLabelText('玩法模板')).toHaveTextContent('上方牌架')
    expect(screen.getByRole('button', { name: '确认方案并开始构建' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('商店跳转链接（HTTPS）'), {
      target: { value: 'https://example.com/store' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ storeUrl: 'https://example.com/store' }))
  })

  it('keeps delivery and store navigation inside the proposal table', () => {
    render(<ConfirmationTable proposal={proposal} onChange={vi.fn()} onConfirm={vi.fn()} />)

    const deliveryRow = screen.getByRole('row', { name: /交付与跳转/ })
    expect(within(deliveryRow).getByLabelText('交付标准')).toHaveTextContent('AppLovin')
    expect(within(deliveryRow).getByText(/360.*640.*单 HTML.*5 MiB/)).toBeInTheDocument()
    expect(within(deliveryRow).getByLabelText('商店跳转链接（HTTPS）')).toBeInTheDocument()
    expect(screen.queryByText('交付与跳转设置')).not.toBeInTheDocument()
  })

  it('lets the user select generic single-HTML delivery', async () => {
    const onChange = vi.fn()
    render(<ConfirmationTable proposal={proposal} onChange={onChange} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('交付标准'))
    fireEvent.click(await screen.findByRole('option', { name: /通用单 HTML/ }))

    expect(onChange).toHaveBeenCalledWith({
      ...proposal,
      delivery: deliveryProfileSnapshot('generic_single_html'),
    })
  })

  it('lets the user customize template, gameplay, and copy in the confirmation table', () => {
    const onChange = vi.fn()
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={onChange}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('玩法说明'), { target: { value: '自定义核心玩法' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gameplay: '自定义核心玩法' }))

    fireEvent.change(screen.getByLabelText('游戏标题'), { target: { value: '夏日消消乐' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ copy: expect.objectContaining({ title: '夏日消消乐' }) }),
    )

    expect(screen.getByLabelText('玩法模板')).toBeEnabled()
    expect(screen.getByLabelText('CTA 文案')).toBeEnabled()
    expect(screen.getByLabelText('语言')).toBeEnabled()
    expect(screen.getByLabelText('免责声明')).toBeEnabled()
  })

  it('labels unsupported gameplay as direct freeform generation', () => {
    render(
      <ConfirmationTable
        proposal={{
          ...proposal,
          routing: { match: 'freeform', confidence: 0.1, differences: ['核心状态机不受模板支持'] },
          gameplay: '自由移动并击败 Boss',
          presentation: {
            assetFields: [
              { slot: 'tileFaces', label: '英雄与怪物' },
              { slot: 'backgroundBoard', label: '战斗场景' },
              { slot: 'animationEffects', label: '攻击特效' },
            ],
            copyFields: ['title', 'cta'],
            showReferenceAssets: false,
          },
        }}
        onChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('自由生成')).toBeInTheDocument()
    expect(screen.getByText('实现方式')).toBeInTheDocument()
    expect(screen.getByText('英雄与怪物')).toBeInTheDocument()
    expect(screen.getByText('战斗场景')).toBeInTheDocument()
    expect(screen.queryByText('音频')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('语言')).not.toBeInTheDocument()
    expect(screen.queryByText('参考素材')).not.toBeInTheDocument()
    expect(screen.getByText(/不受参考模板状态机限制/)).toBeInTheDocument()
  })

  it('polls authoritative build state while keeping the successful preview available', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        task: {
          phase: 'awaiting_confirmation',
          hasArtifact: true,
          artifactVersion: 'old',
          confirmation: { ...proposal, mode: 'center_collision', storeUrl: 'https://example.com/store' },
        },
        events: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableWorkspace
        taskId="task-7"
        initialApiKeyConfigured
        initialPhase="building"
        initialProposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        initialHasArtifact
        initialArtifactVersion="old"
      />,
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-7/events', { cache: 'no-store' }),
    )
    expect(screen.getByRole('region', { name: '构建进度' })).toHaveTextContent('当前状态：生成试玩')
    expect(screen.queryByRole('region', { name: '确认方案' })).not.toBeInTheDocument()
    expect(screen.getByTitle('Playable preview')).toBeInTheDocument()
  })

  it('shows the safe provider error returned by a failed build event', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        task: {
          phase: 'failed',
          hasArtifact: false,
          artifactVersion: null,
          confirmation: proposal,
        },
        events: [
          {
            id: 'event-1',
            type: 'build_failed',
            phase: 'failed',
            message: 'OpenAI API 额度已用尽，请充值或更换 API Key 后重试。',
            createdAt: new Date(0).toISOString(),
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlayableWorkspace taskId="task-7" initialApiKeyConfigured initialPhase="building" initialProposal={proposal} />,
    )

    expect(await screen.findByText('OpenAI API 额度已用尽，请充值或更换 API Key 后重试。')).toBeInTheDocument()
  })

  it('keeps the last safe build error visible after reloading a failed task', () => {
    vi.stubGlobal('fetch', vi.fn())

    render(
      <PlayableWorkspace
        taskId="task-7"
        initialApiKeyConfigured
        initialPhase="failed"
        initialProposal={proposal}
        initialBuildFailureMessage="OpenAI API 额度已用尽，请充值或更换 API Key 后重试。"
      />,
    )

    expect(screen.getByText('OpenAI API 额度已用尽，请充值或更换 API Key 后重试。')).toBeInTheDocument()
  })

  it('keeps an AppLovin delivery warning visible after reloading a ready task', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ builds: [] })),
    )

    render(
      <PlayableWorkspace
        taskId="task-7"
        initialApiKeyConfigured
        initialPhase="ready"
        initialProposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        initialHasArtifact
        initialArtifactVersion="oversized-build"
        initialValidation={{
          buildPassed: true,
          deliveryCompliant: false,
          bytes: 6 * 1024 * 1024,
          delivery: { profileId: 'applovin', label: 'AppLovin', maxBytes: 5 * 1024 * 1024 },
        }}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('不符合 AppLovin 体积要求')
  })

  it('does not poll events while a task is idle', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<PlayableWorkspace taskId="task-idle" initialApiKeyConfigured initialPhase="draft" />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not block the initial prompt or automatically start video analysis', async () => {
    const videoAsset = {
      id: 'video-2',
      slot: 'referenceVideo' as const,
      filename: 'new-gameplay.mp4',
      mimeType: 'video/mp4',
      size: 5,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/messages')) {
        return new Response(`${JSON.stringify({ type: 'informational', message: '已进入需求 Agent' })}\n`)
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PlayableWorkspace
        taskId="task-7"
        initialApiKeyConfigured
        initialPrompt="参考视频制作试玩"
        initialAssets={[videoAsset]}
        initialVideoAnalysisStatus="analyzing"
      />,
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/playable-tasks/task-7/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: '参考视频制作试玩', attachmentIds: ['video-2'] }),
        }),
      ),
    )
    expect(
      fetchMock.mock.calls.some((call) => {
        const [input, init] = call as unknown as [RequestInfo | URL, RequestInit?]
        return String(input).endsWith('/analysis') && init?.method === 'POST'
      }),
    ).toBe(false)
  })

  it('uploads exactly one file into its selected pending resource slot', async () => {
    const onProposal = vi.fn()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        asset: { id: 'asset-1', slot: 'audio', filename: 'sound.mp3', mimeType: 'audio/mpeg', size: 3 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={proposal}
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('为音频上传素材'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'sound.mp3', { type: 'audio/mpeg' })] },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, options] = fetchMock.mock.calls[0]
    expect(options?.body).toBeInstanceOf(FormData)
    expect((options?.body as FormData).get('slot')).toBe('audio')
    await waitFor(() =>
      expect(onProposal).toHaveBeenCalledWith({
        ...proposal,
        resources: {
          ...proposal.resources,
          audio: { status: '用户上传', treatment: 'sound.mp3' },
        },
      }),
    )
  })

  it('uploads a reference video without assigning it to a production resource slot', async () => {
    const onProposal = vi.fn()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        asset: {
          id: 'reference-1',
          slot: 'referenceVideo',
          filename: 'reference.webm',
          mimeType: 'video/webm',
          size: 5,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={proposal}
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('选择参考视频'), {
      target: { files: [new File(['video'], 'reference.webm', { type: 'video/webm' })] },
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, options] = fetchMock.mock.calls[0]
    expect((options?.body as FormData).get('slot')).toBe('referenceVideo')
    expect(await screen.findByText('reference.webm')).toBeInTheDocument()
    expect(onProposal).not.toHaveBeenCalled()
  })

  it('parses a final NDJSON frame, reports malformed frames, and posts confirmation', async () => {
    const confirmationLine = JSON.stringify({
      type: 'confirmation',
      confirmation: { ...proposal, storeUrl: 'https://x.test' },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(`${confirmationLine}`))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const onProposal = vi.fn()
    const { rerender } = render(
      <ChatWorkspace
        taskId="task-7"
        phase="draft"
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '做一个试玩' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    await waitFor(() => expect(onProposal).toHaveBeenCalled())

    const readyProposal = {
      ...proposal,
      storeUrl: 'https://x.test',
      resources: {
        ...proposal.resources,
        tileFaces: { status: '内置默认' as const, treatment: '默认' },
        audio: { status: '内置默认' as const, treatment: '默认' },
      },
    }
    rerender(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={readyProposal}
        onProposal={onProposal}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认方案并开始构建' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/playable-tasks/task-7/confirm',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('keeps a completed revision successful when the stream closes with an error afterward', async () => {
    let pullCount = 0
    const responseStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1
          controller.enqueue(
            new TextEncoder().encode(
              `${JSON.stringify({
                type: 'revision',
                message: '修改计划已整理，请确认后开始构建。',
                confirmation: { ...proposal, storeUrl: 'https://example.com/store' },
                revision,
              })}\n`,
            ),
          )
          return
        }
        controller.error(new Error('connection closed'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(responseStream)),
    )

    render(
      <ChatWorkspace
        taskId="task-7"
        phase="ready"
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        hasArtifact
        onProposal={vi.fn()}
        onRevision={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '去掉标题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(await screen.findByText('修改计划已整理，请确认后开始构建。')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('试玩需求')).toBeEnabled())
    expect(screen.queryByText('回复已中断')).not.toBeInTheDocument()
  })

  it('sends the composed message when Enter is pressed', async () => {
    const fetchMock = vi.fn(async () => new Response(`${JSON.stringify({ type: 'informational', message: '收到' })}\n`))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace taskId="task-7" phase="draft" onProposal={vi.fn()} onPhase={vi.fn()} onRequireApiKey={vi.fn()} />,
    )

    const input = screen.getByLabelText('试玩需求')
    fireEvent.change(input, { target: { value: '按回车发送' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/playable-tasks/task-7/messages',
        expect.objectContaining({ body: JSON.stringify({ message: '按回车发送' }) }),
      ),
    )
  })

  it('stages composer media locally, then uploads everything before sending the message', async () => {
    const uploadedAssets = [
      {
        id: 'image-1',
        slot: 'referenceImage' as const,
        filename: 'board.png',
        mimeType: 'image/png',
        size: 5,
      },
      {
        id: 'video-1',
        slot: 'referenceVideo' as const,
        filename: 'gameplay.mp4',
        mimeType: 'video/mp4',
        size: 5,
      },
    ]
    let uploadIndex = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/assets')) {
        return Response.json({ asset: uploadedAssets[uploadIndex++] }, { status: 201 })
      }
      return new Response(`${JSON.stringify({ type: 'informational', message: '收到素材' })}\n`)
    })
    const onAssetsChange = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="draft"
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
        onAssetsChange={onAssetsChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('选择参考图片或视频'), {
      target: {
        files: [
          new File(['image'], 'board.png', { type: 'image/png' }),
          new File(['video'], 'gameplay.mp4', { type: 'video/mp4' }),
        ],
      },
    })

    expect(await screen.findByText('board.png')).toBeInTheDocument()
    expect(await screen.findByText('gameplay.mp4')).toBeInTheDocument()
    expect(screen.getAllByText('待上传')).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '参考这些素材制作' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(await screen.findByText('收到素材')).toBeInTheDocument()
    const uploadCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/assets'))
    expect((uploadCalls[0][1]?.body as FormData).get('slot')).toBe('referenceImage')
    expect((uploadCalls[1][1]?.body as FormData).get('slot')).toBe('referenceVideo')
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/playable-tasks/task-7/assets',
      '/api/playable-tasks/task-7/assets',
      '/api/playable-tasks/task-7/messages',
    ])
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/playable-tasks/task-7/messages',
      expect.objectContaining({
        body: JSON.stringify({ message: '参考这些素材制作', attachmentIds: ['image-1', 'video-1'] }),
      }),
    )
    expect(onAssetsChange).toHaveBeenLastCalledWith(uploadedAssets)
    expect(screen.getAllByText('board.png')).toHaveLength(1)
    expect(screen.getAllByText('gameplay.mp4')).toHaveLength(1)
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith('/analysis') && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('keeps mixed upload results and retries only failed composer attachments', async () => {
    const imageAsset = {
      id: 'image-success',
      slot: 'referenceImage' as const,
      filename: 'success.png',
      mimeType: 'image/png',
      size: 5,
    }
    const videoAsset = {
      id: 'video-retry',
      slot: 'referenceVideo' as const,
      filename: 'retry.mp4',
      mimeType: 'video/mp4',
      size: 5,
    }
    let videoAttempts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/assets')) {
        const filename = ((init?.body as FormData).get('file') as File).name
        if (filename === 'success.png') return Response.json({ asset: imageAsset }, { status: 201 })
        videoAttempts += 1
        return videoAttempts === 1
          ? new Response(null, { status: 500 })
          : Response.json({ asset: videoAsset }, { status: 201 })
      }
      return new Response(`${JSON.stringify({ type: 'informational', message: '重试成功' })}\n`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace taskId="task-7" phase="draft" onProposal={vi.fn()} onPhase={vi.fn()} onRequireApiKey={vi.fn()} />,
    )

    fireEvent.change(screen.getByLabelText('选择参考图片或视频'), {
      target: {
        files: [
          new File(['image'], 'success.png', { type: 'image/png' }),
          new File(['video'], 'retry.mp4', { type: 'video/mp4' }),
        ],
      },
    })
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '带附件重试' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(await screen.findByText('上传失败')).toBeInTheDocument()
    expect(screen.getByText('已上传')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/messages'))).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(await screen.findByText('重试成功')).toBeInTheDocument()
    const uploadCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/assets'))
    expect(uploadCalls).toHaveLength(3)
    expect(uploadCalls.map(([, init]) => ((init?.body as FormData).get('file') as File).name)).toEqual([
      'success.png',
      'retry.mp4',
      'retry.mp4',
    ])
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/playable-tasks/task-7/messages',
      expect.objectContaining({
        body: JSON.stringify({ message: '带附件重试', attachmentIds: ['image-success', 'video-retry'] }),
      }),
    )
  })

  it('removes staged attachments locally and deletes uploaded attachments after a message failure', async () => {
    const uploadedAsset = {
      id: 'uploaded-image',
      slot: 'referenceImage' as const,
      filename: 'uploaded.png',
      mimeType: 'image/png',
      size: 5,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/assets') && init?.method === 'POST') {
        return Response.json({ asset: uploadedAsset }, { status: 201 })
      }
      if (String(input).endsWith('/messages')) return new Response(null, { status: 500 })
      if (String(input).endsWith('/assets/uploaded-image') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace taskId="task-7" phase="draft" onProposal={vi.fn()} onPhase={vi.fn()} onRequireApiKey={vi.fn()} />,
    )

    const input = screen.getByLabelText('选择参考图片或视频')
    fireEvent.change(input, {
      target: { files: [new File(['local'], 'local.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: '移除附件 local.png' }))
    await waitFor(() => expect(screen.queryByText('local.png')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(input, {
      target: { files: [new File(['uploaded'], 'uploaded.png', { type: 'image/png' })] },
    })
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '保留已上传附件' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法生成确认方案')
    expect(screen.getAllByText('已上传')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '移除附件 uploaded.png' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/playable-tasks/task-7/assets/uploaded-image', { method: 'DELETE' }),
    )
    expect(screen.queryByRole('button', { name: '移除附件 uploaded.png' })).not.toBeInTheDocument()
  })

  it('renders an assistant clarification, decision rationale, quick choices, and loading over an existing proposal', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-7"
        phase="awaiting_confirmation"
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '我想换一种玩法' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(screen.getByRole('region', { name: 'Thinking' })).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()

    resolveFetch(
      new Response(
        [
          JSON.stringify({ type: 'assistant_progress', message: '请选择', reasoning: '正在判断核心玩法。' }),
          JSON.stringify({
            type: 'clarification',
            message: '请选择一种玩法。',
            reasoning: '当前描述没有指定核心消除机制。',
            options: [
              { id: 'center', label: '中心碰撞', description: '配对后碰撞', value: '选择中心碰撞玩法' },
              { id: 'rack', label: '上方牌架', description: '选牌进入牌架', value: '选择上方牌架玩法' },
            ],
          }),
        ].join('\n'),
      ),
    )

    expect(await screen.findByText('请选择一种玩法。')).toBeInTheDocument()
    expect(screen.getByText(/当前描述没有指定核心消除机制/)).toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: '助手回复' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /中心碰撞/ }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/playable-tasks/task-7/messages',
        expect.objectContaining({ body: JSON.stringify({ message: '选择中心碰撞玩法' }) }),
      ),
    )
  })

  it('keeps AI generation disabled while allowing local uploads before confirmation', () => {
    const onChange = vi.fn()
    const onUpload = vi.fn()
    render(
      <ConfirmationTable
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onChange={onChange}
        onConfirm={vi.fn()}
        onUpload={onUpload}
      />,
    )

    expect(screen.getByRole('button', { name: 'AI 生成牌面素材（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成背景与棋盘（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成动画与特效（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成音频（暂不支持）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'AI 生成结束卡（暂不支持）' })).toBeDisabled()

    const backgroundInput = screen.getByLabelText('为背景与棋盘上传素材')
    expect(backgroundInput).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif')
    fireEvent.change(backgroundInput, {
      target: { files: [new File(['image'], 'board.png', { type: 'image/png' })] },
    })
    expect(onUpload).toHaveBeenCalledWith('backgroundBoard', [expect.objectContaining({ name: 'board.png' })])

    expect(screen.getByRole('button', { name: '上传参考图片' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '上传参考视频' })).toBeEnabled()
    expect(screen.getByLabelText('选择参考图片')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif')
    expect(screen.getByLabelText('选择参考视频')).toHaveAttribute('accept', 'video/mp4,video/webm')
  })

  it('blocks a legacy AI-generated plan until the user chooses an available asset source', () => {
    render(
      <ConfirmationTable
        proposal={{
          ...proposal,
          storeUrl: 'https://example.com/store',
          resources: {
            ...proposal.resources,
            tileFaces: { status: '待生成', treatment: '生成主题牌面' },
          },
        }}
        onChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('AI 素材生成暂不支持，请改用内置默认或本地上传。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认方案并开始构建' })).toBeDisabled()
  })

  it('automatically submits the initial prompt once in local Codex mode', async () => {
    let requestSignal: AbortSignal | null | undefined
    let resolveFetch!: (response: Response) => void
    const responsePromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const confirmationLine = JSON.stringify({
      type: 'confirmation',
      confirmation: { ...proposal, storeUrl: 'https://example.com/store' },
    })
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal
      return responsePromise
    })
    vi.stubGlobal('fetch', fetchMock)
    const onProposal = vi.fn()

    render(
      <StrictMode>
        <ChatWorkspace
          taskId="task-local-codex"
          initialPrompt="做一个中心碰撞试玩"
          phase="draft"
          onProposal={onProposal}
          onPhase={vi.fn()}
          onRequireApiKey={vi.fn()}
          autoSubmitInitialPrompt
        />
      </StrictMode>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(screen.getByRole('region', { name: 'Thinking' })).toBeInTheDocument()
    resolveFetch(new Response(confirmationLine))
    await waitFor(() => expect(onProposal).toHaveBeenCalledOnce())
    expect(requestSignal?.aborted).toBe(false)
    expect(screen.queryByText('已停止生成确认方案')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-local-codex/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: '做一个中心碰撞试玩' }),
      }),
    )
    expect(screen.getAllByText('做一个中心碰撞试玩')).toHaveLength(1)
  })

  it('surfaces malformed NDJSON and aborts an in-flight confirmation on stop', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{malformed'))
      .mockImplementationOnce((_url, options) => {
        capturedSignal = options?.signal
        return new Promise((_resolve, reject) =>
          capturedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        )
      })
    vi.stubGlobal('fetch', fetchMock)
    const props = {
      taskId: 'task-7',
      phase: 'draft' as const,
      onProposal: vi.fn(),
      onPhase: vi.fn(),
      onRequireApiKey: vi.fn(),
    }
    const { unmount } = render(<ChatWorkspace {...props} />)
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '坏帧' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('响应数据格式错误')

    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '停止我' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(capturedSignal?.aborted).toBe(true)
    unmount()
  })

  it('uses only the authenticated artifact endpoint in a scripts-only sandbox', () => {
    render(<PlayablePreview taskId="task-7" phase="ready" />)

    const iframe = screen.getByTitle('Playable preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe).toHaveAttribute('src', '/api/playable-tasks/task-7/artifact?kind=playable')
  })

  it('starts muted and unmutes through postMessage without adding iframe permissions or replacing the frame', () => {
    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="v1" />)
    const iframe = screen.getByTitle('Playable preview') as HTMLIFrameElement
    const frameBefore = iframe
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')

    fireEvent.click(screen.getByRole('button', { name: '取消静音预览' }))

    expect(postMessage).toHaveBeenCalledWith({ type: 'playable:set-muted', muted: false }, '*')
    expect(screen.getByRole('button', { name: '静音预览' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTitle('Playable preview')).toBe(frameBefore)
    expect(iframe).not.toHaveAttribute('allow')
  })

  it('keeps a server-authoritative previous artifact on failed reload and refreshes for a new version', () => {
    const { rerender } = render(
      <PlayablePreview taskId="task-7" phase="failed" hasArtifact artifactVersion="old-build" />,
    )
    const oldFrame = screen.getByTitle('Playable preview')
    expect(oldFrame).toHaveAttribute('src', '/api/playable-tasks/task-7/artifact?kind=playable')

    rerender(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="new-build" />)

    expect(screen.getByTitle('Playable preview')).not.toBe(oldFrame)
  })

  it('loads and switches between successful playable versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          builds: [
            {
              id: 'build-1',
              status: 'succeeded',
              version: 1,
              current: false,
              validation: null,
              createdAt: new Date(1).toISOString(),
              completedAt: new Date(2).toISOString(),
            },
            {
              id: 'build-2',
              status: 'succeeded',
              version: 2,
              current: true,
              validation: {
                buildPassed: true,
                deliveryCompliant: false,
                bytes: 6 * 1024 * 1024,
                delivery: { profileId: 'applovin', label: 'AppLovin', maxBytes: 5 * 1024 * 1024 },
              },
              createdAt: new Date(3).toISOString(),
              completedAt: new Date(4).toISOString(),
            },
          ],
        }),
      ),
    )
    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="build-2" />)

    await waitFor(() =>
      expect(screen.getByTitle('Playable preview')).toHaveAttribute(
        'src',
        '/api/playable-tasks/task-7/artifact?kind=playable&version=build-2',
      ),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('不符合 AppLovin 体积要求')
    fireEvent.click(screen.getByLabelText('选择试玩版本'))
    fireEvent.click(await screen.findByRole('option', { name: 'v1' }))
    await waitFor(() =>
      expect(screen.getByTitle('Playable preview')).toHaveAttribute(
        'src',
        '/api/playable-tasks/task-7/artifact?kind=playable&version=build-1',
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens the version requested by a conversation deep link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          builds: [
            {
              id: 'build-1',
              status: 'succeeded',
              version: 1,
              current: false,
              validation: null,
              createdAt: new Date(1).toISOString(),
              completedAt: new Date(2).toISOString(),
            },
            {
              id: 'build-2',
              status: 'succeeded',
              version: 2,
              current: true,
              validation: null,
              createdAt: new Date(3).toISOString(),
              completedAt: new Date(4).toISOString(),
            },
          ],
        }),
      ),
    )

    render(
      <PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="build-2" initialBuildId="build-1" />,
    )

    await waitFor(() =>
      expect(screen.getByTitle('Playable preview')).toHaveAttribute(
        'src',
        '/api/playable-tasks/task-7/artifact?kind=playable&version=build-1',
      ),
    )
  })

  it('previews and downloads an oversized AppLovin build with a delivery warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          builds: [
            {
              id: 'oversized-build',
              status: 'succeeded',
              version: 1,
              current: true,
              validation: {
                buildPassed: true,
                deliveryCompliant: false,
                bytes: 6 * 1024 * 1024,
                delivery: { profileId: 'applovin', label: 'AppLovin', maxBytes: 5 * 1024 * 1024 },
              },
              createdAt: new Date(1).toISOString(),
              completedAt: new Date(2).toISOString(),
            },
          ],
        }),
      ),
    )

    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="oversized-build" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '产物已成功生成，但不符合 AppLovin 体积要求。当前大小 6.0 MiB，上限 5.0 MiB。',
    )
    expect(screen.getByTitle('Playable preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载交付物' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '继续修改并压缩' })).toBeEnabled()
  })

  it('keeps the previous version visible and can retry a failed build', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/versions')) {
        return Response.json({
          builds: [
            {
              id: 'build-1',
              status: 'succeeded',
              version: 1,
              current: true,
              createdAt: new Date(1).toISOString(),
              completedAt: new Date(2).toISOString(),
            },
          ],
        })
      }
      return Response.json({ task: { phase: 'building' } }, { status: 202 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onPhase = vi.fn()
    render(
      <PlayablePreview
        taskId="task-7"
        phase="failed"
        hasArtifact
        artifactVersion="build-1"
        confirmation={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onPhase={onPhase}
      />,
    )

    expect(screen.getByText('本次构建失败，正在展示上一成功版本。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试构建' }))
    await waitFor(() => expect(onPhase).toHaveBeenCalledWith('building'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playable-tasks/task-7/confirm',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the device frame within the available preview height after a failed build', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ builds: [] })),
    )

    render(<PlayablePreview taskId="task-7" phase="failed" hasArtifact artifactVersion="build-1" />)

    const canvas = screen.getByLabelText(/竖屏画布/)
    expect(canvas).toHaveClass('max-h-full')
    expect(canvas.style.width).not.toContain('100dvh')
  })

  it('keeps natural-language chat available after a successful build', async () => {
    const fetchMock = vi.fn(
      async () => new Response(`${JSON.stringify({ type: 'informational', message: '可以继续修改当前试玩。' })}\n`),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ChatWorkspace
        taskId="task-ready"
        phase="ready"
        proposal={{ ...proposal, storeUrl: 'https://example.com/store' }}
        onProposal={vi.fn()}
        onPhase={vi.fn()}
        onRequireApiKey={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('试玩需求')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('试玩需求'), { target: { value: '把标题改得更轻松' } })
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }))
    expect(await screen.findByText('可以继续修改当前试玩。')).toBeInTheDocument()
  })

  it('makes a successful artifact downloadable without a separate acceptance action', async () => {
    const fetchMock = vi.fn(async () => Response.json({ builds: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlayablePreview taskId="task-7" phase="ready" hasArtifact artifactVersion="build-1" />)

    expect(screen.getByRole('group', { name: '预览控制' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载交付物' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '验收通过' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '返回修改' })).not.toBeInTheDocument()
  })
})
