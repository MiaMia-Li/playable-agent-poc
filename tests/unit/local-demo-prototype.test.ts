import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalDemoMode, localDemoRuntime } from '@/lib/playable/local-demo-prototype'
import type { PlayableModeId } from '@/lib/playable/types'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local demo prototype', () => {
  it('does not turn an informational message into a revision after a build', async () => {
    const initial = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'informational-task',
      prompt: '经典国风主题，中心碰撞玩法，使用内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })
    if (initial.kind !== 'confirmation') throw new Error('Expected a confirmation reply')

    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'informational-task',
      prompt: '现在是什么版本？',
      apiKey: 'sk-test-local-demo',
      confirmation: initial.confirmation,
      hasArtifact: true,
    })

    expect(reply.kind).toBe('informational')
  })

  it('collects gameplay, asset strategy, and launch details before returning a confirmation', async () => {
    const gameplayReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '制作一个麻将消消乐',
      apiKey: 'sk-test-local-demo',
    })
    expect(gameplayReply.kind).toBe('clarification')
    if (gameplayReply.kind !== 'clarification') throw new Error('Expected gameplay clarification')

    const themeReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: 'center_collision',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
      ],
    })

    expect(themeReply.kind).toBe('clarification')
    if (themeReply.kind !== 'clarification') throw new Error('Expected theme clarification')
    expect(themeReply.message).toContain('视觉主题')

    const assetReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '经典国风主题',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
        { role: 'user', content: 'center_collision' },
        { role: 'assistant', content: themeReply.message },
      ],
    })

    expect(assetReply.kind).toBe('clarification')
    if (assetReply.kind !== 'clarification') throw new Error('Expected asset clarification')
    expect(assetReply.message).toContain('素材')

    const launchReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '图片和音频使用系统素材',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
        { role: 'user', content: 'center_collision' },
        { role: 'assistant', content: themeReply.message },
        { role: 'user', content: '经典国风主题' },
        { role: 'assistant', content: assetReply.message },
      ],
    })

    expect(launchReply.kind).toBe('clarification')
    if (launchReply.kind !== 'clarification') throw new Error('Expected launch clarification')
    expect(launchReply.message).toMatch(/文案|链接/)

    const confirmationReply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'conversation-task',
      prompt: '使用默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
      history: [
        { role: 'user', content: '制作一个麻将消消乐' },
        { role: 'assistant', content: gameplayReply.message },
        { role: 'user', content: 'center_collision' },
        { role: 'assistant', content: themeReply.message },
        { role: 'user', content: '经典国风主题' },
        { role: 'assistant', content: assetReply.message },
        { role: 'user', content: '图片和音频使用系统素材' },
        { role: 'assistant', content: launchReply.message },
      ],
    })

    expect(confirmationReply.kind).toBe('confirmation')
  })

  it('selects each supported mode from a short requirement', async () => {
    const cases: Array<[string, PlayableModeId]> = [
      ['经典国风主题，中心碰撞玩法，使用内置默认素材、默认文案和测试链接', 'center_collision'],
      ['经典国风主题，使用上方牌架、内置默认素材、默认文案和测试链接', 'top_rack'],
      ['经典国风主题，消除后下落补位，使用内置默认素材、默认文案和测试链接', 'gravity_fill'],
      ['经典国风主题，制作 3D 立体牌墙，使用内置默认素材、默认文案和测试链接', 'perspective_3d'],
    ]

    for (const [prompt, mode] of cases) {
      const reply = await localDemoRuntime.agent.proposeConfirmation({
        taskId: 'local-task',
        prompt,
        apiKey: 'sk-test-local-demo',
      })
      expect(reply.kind).toBe('confirmation')
      if (reply.kind === 'confirmation') expect(reply.confirmation.mode).toBe(mode)
    }
  })

  it('marks presentation-only Boss changes as an approximate template match', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-approximate',
      prompt: '经典国风主题，中心碰撞闯关并战胜 Boss，使用内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })

    expect(reply.kind).toBe('confirmation')
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    expect(reply.confirmation.routing.match).toBe('approximate')
    expect(reply.confirmation.routing.differences).toContain(
      'Boss 生命值与关卡推进不属于模板核心，由大模型在现有玩法上补充',
    )
  })

  it('routes unsupported core gameplay to direct freeform generation', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-freeform',
      prompt: '霓虹风格跑酷，躲避障碍后到达终点，使用内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })

    expect(reply.kind).toBe('confirmation')
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    expect(reply.confirmation.routing.match).toBe('freeform')
    expect(reply.message).toContain('大模型自由生成')

    const result = await localDemoRuntime.agent.build({
      taskId: 'local-freeform',
      apiKey: 'sk-test-local-demo',
      confirmation: reply.confirmation,
      assets: [],
    })
    expect(result.validation.passed).toBe(true)
    expect(result.html).toContain("mode:'freeform'")
  })

  it('builds and behavior-checks an offline playable with the vendored Skill', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-task',
      prompt: '经典国风主题，使用上方牌架、内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    const result = await localDemoRuntime.agent.build({
      taskId: 'local-task',
      apiKey: 'sk-test-local-demo',
      confirmation: reply.confirmation,
      assets: [],
    })

    expect(result.validation.behavior).toBe('passed')
    expect(result.validation.bytes).toBeLessThan(5 * 1024 * 1024)
    expect(result.html).toContain('window.__PLAYABLE__')
    expect(result.html).not.toContain('sk-test-local-demo')
  })

  it('simulates selected AI media offline instead of calling OpenAI', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-media-task',
      prompt: '经典国风主题，使用中心碰撞玩法、内置默认素材、默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })
    if (reply.kind !== 'confirmation') throw new Error('Expected a confirmation reply')
    const confirmation = {
      ...reply.confirmation,
      resources: {
        ...reply.confirmation.resources,
        backgroundBoard: { status: '待生成' as const, treatment: '生成农场背景' },
        audio: { status: '待生成' as const, treatment: '生成欢快配音' },
      },
    }

    const assets = await localDemoRuntime.mediaGenerator({
      taskId: 'local-media-task',
      apiKey: 'sk-test-local-demo',
      confirmation,
    })

    expect(assets.map((asset) => asset.slot)).toEqual(['backgroundBoard', 'audio'])
    expect(assets.every((asset) => asset.bytes.byteLength > 0)).toBe(true)
  })

  it('does not expose AI media generation as a selectable asset strategy', async () => {
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-generated-plan',
      prompt: '经典国风主题，中心碰撞玩法，图片和音频素材全部使用 AI 生成，使用默认文案和测试链接',
      apiKey: 'sk-test-local-demo',
    })

    expect(reply.kind).toBe('clarification')
    if (reply.kind !== 'clarification') throw new Error('Expected a clarification reply')
    expect(reply.reasoning).toContain('暂不支持 AI 素材生成')
    expect(reply.options.map((option) => option.id)).toEqual(['bundled', 'uploaded'])
  })

  it('provides deterministic market research with selectable persisted candidates', async () => {
    const task = await localDemoRuntime.repository.createTask({
      id: 'local-research-task',
      userId: 'local-demo-user',
      prompt: '搜索麻将配对试玩案例',
    })
    const searchBrief = {
      version: 1 as const,
      trigger: 'explicit' as const,
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
    await localDemoRuntime.repository.createResearchRun?.({
      id: 'local-research-run',
      taskId: task.id,
      userId: task.userId,
      brief: searchBrief,
      cacheKey: 'local-demo-cache',
      strategyVersion: 'public-web-v1',
      sourceIds: ['tiktok-creative-center'],
    })

    const report = await localDemoRuntime.marketResearchAgent.search({
      runId: 'local-research-run',
      apiKey: 'sk-test-local-demo',
      brief: searchBrief,
    })
    const saved = await localDemoRuntime.repository.completeResearchRun?.('local-research-run', task.id, report)
    const selected = await localDemoRuntime.repository.saveReferenceSelection?.({
      id: 'local-selection',
      taskId: task.id,
      userId: task.userId,
      selection: {
        runId: 'local-research-run',
        primaryCandidateId: saved?.candidates[0]?.id ?? null,
        selectedHighlights: saved?.candidates[0]
          ? [{ candidateId: saved.candidates[0].id, value: saved.candidates[0].borrowableHighlights[0] }]
          : [],
        customRequirements: '',
        exclusions: [],
      },
    })

    expect(saved?.candidates).toHaveLength(3)
    expect(selected?.primaryCandidate?.id).toBe(saved?.candidates[0]?.id)
  })

  it('routes explicit market-search intent through the research tool', async () => {
    const search = vi.fn(async () =>
      localDemoRuntime.marketResearchAgent.search({
        runId: 'local-intent-run',
        apiKey: 'sk-test-local-demo',
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
      }),
    )

    const reply = await localDemoRuntime.agent.proposeConfirmation(
      {
        taskId: 'local-intent-task',
        prompt: '先帮我搜索并分析同类麻将配对试玩广告',
        apiKey: 'sk-test-local-demo',
      },
      { executeTool: search },
    )

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ name: 'search_market_references' }))
    expect(reply.kind).toBe('research')
  })

  it('adds an adopted research direction to the next local requirement brief', async () => {
    const report = await localDemoRuntime.marketResearchAgent.search({
      runId: 'local-adoption-run',
      apiKey: 'sk-test-local-demo',
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
    const reply = await localDemoRuntime.agent.proposeConfirmation({
      taskId: 'local-adoption-task',
      prompt: '采用此方向',
      apiKey: 'sk-test-local-demo',
      referenceSelection: {
        runId: report.runId,
        industrySummary: report.industrySummary,
        primaryCandidate: report.candidates[0],
        selectedHighlights: [{ candidate: report.candidates[1], value: report.candidates[1].borrowableHighlights[0] }],
        customRequirements: '保持节奏轻快',
        exclusions: [],
      },
    })

    expect(reply.kind).toBe('clarification')
    if (reply.kind !== 'clarification') throw new Error('Expected a clarification reply')
    if (!reply.brief) throw new Error('Expected an updated brief')
    expect(reply.brief.summary).toContain(report.candidates[0].title)
    expect(reply.brief.summary).toContain(report.candidates[1].borrowableHighlights[0])
  })

  it('cannot bypass authentication in production', () => {
    vi.stubEnv('LOCAL_DEMO_MODE', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(isLocalDemoMode()).toBe(false)
  })
})
