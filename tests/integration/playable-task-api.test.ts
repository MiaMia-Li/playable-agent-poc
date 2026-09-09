import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createPlayableTaskHandlers,
  runConfirmedBuild,
  type BackgroundScheduler,
  type PlayableBuildRecord,
  type PlayableTaskRecord,
  type PlayableTaskRepository,
  type PlayableVideoAnalysisRecord,
} from '@/lib/playable/task-api'
import { PrivateVercelArtifactStore, type ArtifactStore, type PrivateBlobClient } from '@/lib/playable/artifact-store'
import type {
  ConfirmationProposal,
  GameplayBlueprint,
  PlayableAgentReply,
  RequirementBrief,
} from '@/lib/playable/schemas'
import { PlayableAgentError, type PlayableAgentAdapter } from '@/lib/playable/playable-agent-adapter'
import type { PlayableAsset } from '@/lib/playable/task-assets'
import { createAssetSourceManifest, createValidationReport } from '@/lib/playable/production-contract'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'

const confirmation: ConfirmationProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] },
  mode: 'center_collision',
  gameplay: 'Match identical tiles.',
  resources: {
    tileFaces: { status: '内置默认', treatment: 'Use bundled tile faces.' },
    backgroundBoard: { status: '内置默认', treatment: 'Use bundled board.' },
    animationEffects: { status: '内置默认', treatment: 'Use bundled effects.' },
    audio: { status: '内置默认', treatment: 'Use bundled audio.' },
    endCard: { status: '内置默认', treatment: 'Use bundled end card.' },
  },
  copy: { title: 'Match', cta: 'Play', disclaimer: '', locale: 'en' },
  storeUrl: 'https://example.com/app',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

const confirmationReply: PlayableAgentReply = {
  kind: 'confirmation',
  message: '方案已经整理完成。',
  reasoning: '玩法已经明确。',
  confirmation,
}

const gameplayBlueprint: GameplayBlueprint = {
  version: 1,
  summary: '点击相同目标后消除。',
  orientation: 'portrait',
  controls: [
    { value: '点击', confidence: 0.9, evidence: [{ startSeconds: 1, endSeconds: 2, observation: '发生点击' }] },
  ],
  sceneStructure: { value: '网格', confidence: 0.9, evidence: [] },
  entities: [],
  coreLoop: { value: '点击并消除相同目标', confidence: 0.9, evidence: [] },
  stateTransitions: [{ value: '目标消失', confidence: 0.9, evidence: [] }],
  objective: { value: '清空目标', confidence: 0.8, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  visualStyle: '卡通风格',
  uncertainties: [],
  overallConfidence: 0.88,
}

type EventRecord = {
  id: string
  taskId: string
  type: string
  phase?: string
  message?: string
  createdAt: Date
  privateData?: unknown
}

function byteStream(value: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value)
      controller.close()
    },
  })
}

class MemoryRepository implements PlayableTaskRepository {
  tasks = new Map<string, PlayableTaskRecord>()
  messages: Array<{ taskId: string; role: 'user' | 'agent'; content: string }> = []
  events: EventRecord[] = []
  latestAssignments: string[] = []
  assets: PlayableAsset[] = []
  builds: PlayableBuildRecord[] = []
  videoAnalyses: PlayableVideoAnalysisRecord[] = []

  async createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord> {
    const task: PlayableTaskRecord = {
      id: input.id,
      userId: input.userId,
      prompt: input.prompt,
      phase: 'draft',
      requirementBrief: null,
      confirmation: null,
      latestArtifactKey: null,
    }
    this.tasks.set(task.id, task)
    return task
  }

  async findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined> {
    const task = this.tasks.get(taskId)
    return task?.userId === userId ? task : undefined
  }

  async appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void> {
    this.messages.push({ taskId, role, content })
  }

  async listMessages(taskId: string) {
    return this.messages
      .filter((message) => message.taskId === taskId)
      .map((message, index) => ({ ...message, id: `message-${index + 1}`, createdAt: new Date(index) }))
  }

  async updateRequirementBrief(taskId: string, userId: string, brief: RequirementBrief): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.requirementBrief = brief
    return true
  }

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
    return true
  }

  async setDraft(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'draft'
    return true
  }

  async claimBuild(
    taskId: string,
    userId: string,
    value: ConfirmationProposal,
    buildId: string,
  ): Promise<PlayableTaskRecord | undefined> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['awaiting_confirmation', 'failed'].includes(task.phase)) return
    task.phase = 'building'
    task.confirmation = value
    this.builds.push({
      id: buildId,
      taskId,
      status: 'building',
      confirmation: value,
      artifactKey: null,
      createdAt: new Date(),
    })
    return { ...task }
  }

  async compareAndSetPhase(
    taskId: string,
    expected: PlayableTaskRecord['phase'],
    next: PlayableTaskRecord['phase'],
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expected) return false
    task.phase = next
    return true
  }

  async publishArtifact(
    taskId: string,
    buildId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expectedPhase) return false
    task.phase = 'ready'
    task.latestArtifactKey = artifactKey
    task.latestValidation = validation
    const build = this.builds.find((candidate) => candidate.taskId === taskId && candidate.id === buildId)
    if (build) {
      build.status = 'succeeded'
      build.artifactKey = artifactKey
      build.validation = validation
      build.completedAt = new Date()
    } else if (task.confirmation) {
      this.builds.push({
        id: buildId,
        taskId,
        status: 'succeeded',
        confirmation: task.confirmation,
        artifactKey,
        validation,
        createdAt: new Date(),
        completedAt: new Date(),
      })
    }
    this.latestAssignments.push(artifactKey)
    return true
  }

  async acceptArtifact(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || task.phase !== 'reviewing') return false
    task.phase = 'ready'
    return true
  }

  async requestRevision(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['reviewing', 'ready', 'failed'].includes(task.phase) || !task.confirmation) return false
    task.phase = 'awaiting_confirmation'
    return true
  }

  async markFailed(taskId: string, buildId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (task && ['building', 'validating'].includes(task.phase)) task.phase = 'failed'
    const build = this.builds.find((candidate) => candidate.taskId === taskId && candidate.id === buildId)
    if (build?.status === 'building') {
      build.status = 'failed'
      build.completedAt = new Date()
    }
  }

  async listBuilds(taskId: string): Promise<PlayableBuildRecord[]> {
    return this.builds.filter((build) => build.taskId === taskId)
  }

  async findBuild(taskId: string, buildId: string): Promise<PlayableBuildRecord | undefined> {
    return this.builds.find((build) => build.taskId === taskId && build.id === buildId)
  }

  async appendEvent(event: Omit<EventRecord, 'id' | 'createdAt'>): Promise<void> {
    this.events.push({ ...event, id: `event-${this.events.length + 1}`, createdAt: new Date(0) })
  }

  async listEvents(taskId: string): Promise<EventRecord[]> {
    return this.events.filter((event) => event.taskId === taskId)
  }

  async listOwnedTasks(userId: string) {
    return [...this.tasks.values()].filter((task) => task.userId === userId)
  }

  async saveAsset(asset: PlayableAsset) {
    this.assets.push(asset)
  }

  async listAssets(taskId: string, userId: string) {
    return this.assets.filter((asset) => asset.taskId === taskId && asset.userId === userId)
  }

  async findOwnedAsset(taskId: string, userId: string, assetId: string) {
    return this.assets.find((asset) => asset.taskId === taskId && asset.userId === userId && asset.id === assetId)
  }

  async deleteOwnedAsset(taskId: string, userId: string, assetId: string) {
    const index = this.assets.findIndex(
      (asset) => asset.taskId === taskId && asset.userId === userId && asset.id === assetId,
    )
    if (index < 0) return undefined
    return this.assets.splice(index, 1)[0]
  }

  async createVideoAnalysis(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
  }): Promise<PlayableVideoAnalysisRecord> {
    const analysis: PlayableVideoAnalysisRecord = {
      ...input,
      status: 'pending',
      blueprint: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: null,
    }
    this.videoAnalyses.push(analysis)
    return analysis
  }

  async findLatestVideoAnalysis(taskId: string): Promise<PlayableVideoAnalysisRecord | undefined> {
    return this.videoAnalyses.filter((analysis) => analysis.taskId === taskId).at(-1)
  }

  async updateVideoAnalysisStatus(id: string, status: PlayableVideoAnalysisRecord['status']): Promise<void> {
    const analysis = this.videoAnalyses.find((candidate) => candidate.id === id)
    if (analysis) analysis.status = status
  }

  async completeVideoAnalysis(id: string, blueprint: GameplayBlueprint): Promise<void> {
    const analysis = this.videoAnalyses.find((candidate) => candidate.id === id)
    if (!analysis) return
    analysis.status = 'succeeded'
    analysis.blueprint = blueprint
    analysis.completedAt = new Date()
  }

  async failVideoAnalysis(id: string, errorCode: string): Promise<void> {
    const analysis = this.videoAnalyses.find((candidate) => candidate.id === id)
    if (!analysis) return
    analysis.status = 'failed'
    analysis.errorCode = errorCode
    analysis.completedAt = new Date()
  }
}

function createHarness() {
  const repository = new MemoryRepository()
  repository.tasks.set('owned', {
    id: 'owned',
    userId: 'user-1',
    prompt: 'Build a game',
    phase: 'draft',
    requirementBrief: null,
    confirmation: null,
    latestArtifactKey: null,
  })
  repository.tasks.set('foreign', {
    id: 'foreign',
    userId: 'user-2',
    prompt: 'Secret task',
    phase: 'ready',
    requirementBrief: null,
    confirmation,
    latestArtifactKey: 'users/user-2/tasks/foreign/build/playable.html',
  })

  const scheduled: Array<() => Promise<void>> = []
  const scheduler: BackgroundScheduler = (work) => scheduled.push(work)
  const agent: PlayableAgentAdapter = {
    proposeConfirmation: vi.fn(async () => confirmationReply),
    build: vi.fn(async () => ({
      html: '<!doctype html><script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 57, offlineResources: true, responsiveViewport: true }),
    })),
    cancel: vi.fn(async () => undefined),
  }
  const artifacts = new Map<string, Uint8Array>()
  const artifactStore: ArtifactStore = {
    put: vi.fn(async (key, value) => {
      artifacts.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value)
    }),
    get: vi.fn(async (key) => {
      const value = artifacts.get(key)
      return value ? byteStream(value) : undefined
    }),
    delete: vi.fn(async (key) => {
      artifacts.delete(key)
    }),
  }
  const videoPreprocessor = {
    preprocess: vi.fn(async () => ({
      durationSeconds: 3,
      sampleRate: 1,
      frames: [{ timestampSeconds: 0, mimeType: 'image/jpeg' as const, bytes: new Uint8Array([2]) }],
    })),
  }
  const videoAnalyst = { analyze: vi.fn(async () => gameplayBlueprint) }
  let authenticatedUserId: string | undefined = 'user-1'
  let apiKey: string | undefined = 'sk-test-secret'
  let mediaApiKey: string | undefined = 'sk-test-media-secret'
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => authenticatedUserId,
    readApiKey: async () => apiKey,
    readMediaApiKey: async () => mediaApiKey,
    repository,
    agent,
    artifactStore,
    videoPreprocessor,
    videoAnalyst,
    schedule: scheduler,
    buildStartedEventTimeoutMs: 10,
    generateId: (() => {
      let id = 0
      return () => `random-${++id}`
    })(),
  })

  return {
    repository,
    scheduled,
    agent,
    artifactStore,
    videoPreprocessor,
    videoAnalyst,
    artifacts,
    handlers,
    setAuthenticatedUser(value: string | undefined) {
      authenticatedUserId = value
    },
    setApiKey(value: string | undefined) {
      apiKey = value
    },
    setMediaApiKey(value: string | undefined) {
      mediaApiKey = value
    },
  }
}

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`https://app.example${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

describe('playable task API', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    harness = createHarness()
  })

  it('returns 401 from every route without authentication', async () => {
    harness.setAuthenticatedUser(undefined)
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const responses = await Promise.all([
      harness.handlers.list(request('/api/playable-tasks')),
      harness.handlers.create(request('/api/playable-tasks', 'POST', { prompt: 'game' })),
      harness.handlers.message(request('/api/playable-tasks/owned/messages', 'POST', { message: 'hello' }), context),
      harness.handlers.analysis(request('/api/playable-tasks/owned/analysis'), context),
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
      harness.handlers.events(request('/api/playable-tasks/owned/events'), context),
      harness.handlers.artifact(request('/api/playable-tasks/owned/artifact?kind=playable'), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
  })

  it('preprocesses a reference video and persists a gameplay blueprint before requirement planning', async () => {
    const video: PlayableAsset = {
      id: 'video-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'private-video',
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    harness.artifacts.set(video.storageKey, new Uint8Array([1]))
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    const queued = await harness.handlers.analysis(request('/api/playable-tasks/owned/analysis', 'POST'), context)

    expect(queued.status).toBe(202)
    expect(harness.scheduled).toHaveLength(1)
    await harness.scheduled[0]()
    expect(harness.videoPreprocessor.preprocess).toHaveBeenCalledOnce()
    expect(harness.videoAnalyst.analyze).toHaveBeenCalledOnce()
    await expect(harness.repository.findLatestVideoAnalysis('owned')).resolves.toMatchObject({
      status: 'succeeded',
      blueprint: gameplayBlueprint,
    })

    const messageResponse = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '参考视频制作试玩' }),
      context,
    )
    await messageResponse.text()
    expect(harness.agent.proposeConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ gameplayBlueprint }),
      expect.any(Object),
    )
  })

  it('creates an authenticated task in draft without returning private fields', async () => {
    const response = await harness.handlers.create(
      request('/api/playable-tasks', 'POST', { prompt: 'Build a mahjong game' }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ task: { id: 'random-1', phase: 'draft' } })
    expect(harness.repository.tasks.get('random-1')).toMatchObject({
      userId: 'user-1',
      prompt: 'Build a mahjong game',
      phase: 'draft',
    })
  })

  it('returns a projected owned playable task list without raw persistence fields', async () => {
    const response = await harness.handlers.list(request('/api/playable-tasks'))
    const body = await response.json()

    expect(body.tasks).toEqual([
      expect.objectContaining({
        id: 'owned',
        prompt: 'Build a game',
        phase: 'draft',
        hasArtifact: false,
        artifactVersion: null,
      }),
    ])
    expect(JSON.stringify(body)).not.toContain('userId')
    expect(JSON.stringify(body)).not.toContain('latestArtifactKey')
    expect(JSON.stringify(body)).not.toContain('users/')
  })

  it('returns the same 404 for missing and cross-user resources', async () => {
    const missing = { params: Promise.resolve({ taskId: 'missing' }) }
    const foreign = { params: Promise.resolve({ taskId: 'foreign' }) }
    const calls = [
      () => harness.handlers.events(request('/api/playable-tasks/missing/events'), missing),
      () => harness.handlers.events(request('/api/playable-tasks/foreign/events'), foreign),
      () => harness.handlers.artifact(request('/api/playable-tasks/missing/artifact?kind=playable'), missing),
      () => harness.handlers.artifact(request('/api/playable-tasks/foreign/artifact?kind=playable'), foreign),
      () =>
        harness.handlers.message(
          request('/api/playable-tasks/foreign/messages', 'POST', { message: 'steal' }),
          foreign,
        ),
      () => harness.handlers.confirm(request('/api/playable-tasks/foreign/confirm', 'POST', { confirmation }), foreign),
    ]
    const responses = await Promise.all(calls.map((call) => call()))

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404])
    for (const response of responses) expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('appends chat messages and streams sanitized agent events', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make it bright sk-leaked1234' }),
      context,
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(body).toContain('"type":"confirmation"')
    expect(body).toContain('"mode":"center_collision"')
    expect(body).not.toContain('sk-test-secret')
    expect(body).not.toContain('sk-leaked1234')
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
    expect(harness.repository.tasks.get('owned')?.confirmation).toEqual(confirmation)
    expect(harness.repository.messages.map(({ role }) => role)).toEqual(['user', 'agent'])
    expect(JSON.stringify(harness.repository.messages)).not.toContain('sk-test-secret')
  })

  it('forwards sanitized partial agent output before the validated final event', async () => {
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      options?.onProgress?.({ message: '方案正在整理', reasoning: '正在匹配可用玩法' })
      return confirmationReply
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; message?: string })

    expect(events.map(({ type }) => type)).toContain('assistant_progress')
    expect(events.find(({ type }) => type === 'assistant_progress')?.message).toBe('方案正在整理')
    expect(events.at(-1)?.type).toBe('confirmation')
  })

  it('streams an informational answer without changing phase or routing the brief', async () => {
    const emptyBrief = createRequirementBrief()
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      kind: 'informational',
      message: '我是试玩创作助手，可以通过对话整理需求并构建试玩。',
      reasoning: '这是能力咨询，不需要评估游戏路由。',
      brief: emptyBrief,
      tools: ['respond_to_user'],
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '你是谁，能做什么？' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const body = await response.text()

    expect(body).toContain('"type":"informational"')
    expect(body).toContain('"tool":"respond_to_user"')
    expect(body).not.toContain('validate_implementation_route')
    expect(harness.repository.tasks.get('owned')?.phase).toBe('draft')
    expect(harness.repository.tasks.get('owned')?.requirementBrief).toEqual(emptyBrief)
    expect(harness.repository.tasks.get('owned')?.confirmation).toBeNull()
  })

  it('keeps an ambiguous theme in draft and streams a clarification with full conversation context', async () => {
    const requirementBrief = {
      ...createRequirementBrief('制作一个农场消消乐风格'),
      experience: { visualTheme: '农场', tone: '轻松', camera: '' },
      openQuestions: ['选择核心玩法'],
    }
    const clarification = {
      kind: 'clarification',
      message: '农场主题已经记下了，请选择一种核心玩法。',
      reasoning: '主题不能唯一确定消除后的移动方式。',
      options: [
        {
          id: 'center_collision',
          label: '中心碰撞',
          description: '相同元素飞向中心碰撞消除',
          value: '选择中心碰撞玩法',
        },
        {
          id: 'gravity_fill',
          label: '下落补位',
          description: '消除后元素从上方下落补位',
          value: '选择下落补位玩法',
        },
      ],
      request: {
        type: 'single_select',
        question: '请选择核心玩法。',
        options: [
          {
            id: 'center_collision',
            label: '中心碰撞',
            description: '相同元素飞向中心碰撞消除',
            value: '选择中心碰撞玩法',
          },
          {
            id: 'gravity_fill',
            label: '下落补位',
            description: '消除后元素从上方下落补位',
            value: '选择下落补位玩法',
          },
        ],
        allowCustom: true,
      },
      brief: requirementBrief,
      tools: ['update_requirement_brief', 'list_playable_capabilities', 'ask_user'],
    } as const
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce(clarification as never)

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '制作一个农场消消乐风格' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const body = await response.text()

    expect(body).toContain('"type":"clarification"')
    expect(body).toContain('"type":"tool_completed"')
    expect(body).toContain('农场主题已经记下了')
    expect(harness.repository.tasks.get('owned')?.phase).toBe('draft')
    expect(harness.repository.tasks.get('owned')?.confirmation).toBeNull()
    expect(harness.repository.tasks.get('owned')?.requirementBrief).toEqual(requirementBrief)
    expect(harness.agent.proposeConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [],
        confirmation: null,
        assets: [],
      }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(harness.repository.messages.map(({ role }) => role)).toEqual(['user', 'agent'])
  })

  it('returns a confirmable freeform route for unsupported state machines', async () => {
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      kind: 'confirmation',
      message: '当前模板无法表达跑酷状态机，将由大模型自由生成。',
      reasoning: '核心输入和失败条件不属于麻将配对。',
      confirmation: {
        ...confirmation,
        routing: {
          match: 'freeform',
          confidence: 0.1,
          differences: ['持续移动、障碍碰撞和失败重开不受现有模板支持'],
        },
        gameplay: '持续移动、躲避障碍并到达终点',
      },
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '制作跑酷试玩' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const body = await response.text()

    expect(body).toContain('"type":"confirmation"')
    expect(body).toContain('"match":"freeform"')
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
    expect(harness.repository.events.at(-1)).toMatchObject({
      type: 'confirmation_proposed',
      phase: 'awaiting_confirmation',
    })
    expect(harness.scheduled).toHaveLength(0)
  })

  it('hides an existing proposal while preserving it as context when a follow-up needs clarification', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      kind: 'clarification',
      message: '你想改成哪一种玩法？',
      reasoning: '用户要求更换玩法但没有指定目标。',
      options: [{ id: 'rack', label: '上方牌架', description: '进入牌架后配对', value: '选择上方牌架玩法' }],
    })

    await (
      await harness.handlers.message(request('/api/playable-tasks/owned/messages', 'POST', { message: '换一种玩法' }), {
        params: Promise.resolve({ taskId: 'owned' }),
      })
    ).text()

    expect(task.phase).toBe('draft')
    expect(task.confirmation).toEqual(confirmation)

    const eventsResponse = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    expect((await eventsResponse.json()).task.confirmation).toBeNull()

    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce(confirmationReply)
    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '改成上方牌架' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()
    expect(harness.agent.proposeConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirmation }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
  })

  it('passes prior turns, the current proposal, and safe uploaded-asset metadata into follow-up messages', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
    harness.repository.messages.push(
      { taskId: 'owned', role: 'user', content: '制作农场主题' },
      {
        taskId: 'owned',
        role: 'agent',
        content: JSON.stringify({
          kind: 'clarification',
          message: '请选择玩法',
          reasoning: '玩法尚未明确',
          options: [{ id: 'center', label: '中心碰撞', description: '碰撞消除', value: '选择中心碰撞玩法' }],
        }),
      },
    )
    harness.repository.assets.push({
      id: 'asset-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'audio',
      filename: 'farm.mp3',
      mimeType: 'audio/mpeg',
      size: 3,
      storageKey: 'private-storage-key',
      createdAt: new Date(0),
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '把标题改成欢乐农场' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(harness.agent.proposeConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: 'user', content: '制作农场主题' },
          { role: 'assistant', content: '请选择玩法' },
        ],
        confirmation,
        assets: [{ id: 'asset-1', slot: 'audio', filename: 'farm.mp3', mimeType: 'audio/mpeg', size: 3 }],
      }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(JSON.stringify(vi.mocked(harness.agent.proposeConfirmation).mock.calls)).not.toContain('private-storage-key')
  })

  it('redacts and revalidates every credential-shaped string in an agent proposal before storage', async () => {
    const otherSecret = 'sk-1234567890abcdefghijklmnop'
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      ...confirmationReply,
      confirmation: { ...confirmation, gameplay: `Leaked ${otherSecret}` },
    })
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    const body = await response.text()
    expect(body).toContain('"type":"confirmation"')
    expect(body).toContain('[REDACTED]')
    expect(harness.repository.messages).toHaveLength(2)
    expect(JSON.stringify(harness.repository.messages)).not.toContain(otherSecret)
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
  })

  it('hard-fails an exact caller-key echo in an agent proposal before sanitization or storage', async () => {
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      ...confirmationReply,
      confirmation: { ...confirmation, gameplay: 'Leaked sk-test-secret' },
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    const body = await response.text()
    expect(body).toContain('"type":"error"')
    expect(body).toContain('Agent 返回的需求方案未通过校验，请重试')
    expect(harness.repository.messages).toHaveLength(1)
    expect(harness.repository.tasks.get('owned')?.phase).toBe('draft')
  })

  it('returns an actionable local Harness configuration error and emits only a static diagnostic', async () => {
    vi.mocked(harness.agent.proposeConfirmation).mockRejectedValueOnce(new PlayableAgentError('sandbox_configuration'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const body = await response.text()

    expect(body).toContain('本地 Harness 缺少 Vercel Sandbox 凭据，请配置后重启服务')
    expect(errorSpy).toHaveBeenCalledWith('Playable requirement processing failed: sandbox credentials unavailable')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('sk-test-secret')
  })

  it('cancels an in-flight message stream without writing to a closed controller or leaking a rejection', async () => {
    let resolveProposal!: (value: PlayableAgentReply) => void
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(
      () => new Promise((resolve) => (resolveProposal = resolve)),
    )
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      const response = await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"started"')
      await reader.cancel()
      resolveProposal(confirmationReply)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(harness.agent.cancel).toHaveBeenCalledWith('owned')
      expect(harness.repository.messages).toHaveLength(1)
      expect(harness.repository.events).toHaveLength(0)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('returns 428 from message and confirmation when the session has no API key', async () => {
    harness.setApiKey(undefined)
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    const messageResponse = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
      context,
    )
    const confirmResponse = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }),
      context,
    )

    expect(messageResponse.status).toBe(428)
    expect(confirmResponse.status).toBe(428)
    expect(harness.scheduled).toHaveLength(0)
  })

  it('rejects AI-generated media while allowing bundled assets to build', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const generatedConfirmation: ConfirmationProposal = {
      ...confirmation,
      resources: {
        ...confirmation.resources,
        backgroundBoard: { status: '待生成', treatment: '生成竖屏农场背景' },
      },
    }

    const generatedResponse = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: generatedConfirmation }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(generatedResponse.status).toBe(400)
    await expect(generatedResponse.json()).resolves.toEqual({ error: 'AI media generation is not supported' })
    expect(harness.scheduled).toHaveLength(0)

    const bundledResponse = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(bundledResponse.status).toBe(202)
    expect(harness.scheduled).toHaveLength(1)
  })

  it('rejects a build until a task is awaiting confirmation', async () => {
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(409)
    expect(harness.scheduled).toHaveLength(0)
    expect(harness.agent.build).not.toHaveBeenCalled()
  })

  it('validates confirmation before atomically claiming and scheduling one build', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const [first, second] = await Promise.all([
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
    ])

    expect([first.status, second.status].sort()).toEqual([202, 409])
    expect(harness.scheduled).toHaveLength(1)
    expect(harness.agent.build).not.toHaveBeenCalled()
    expect(harness.repository.tasks.get('owned')?.phase).toBe('building')

    const invalid = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        confirmation: { ...confirmation, mode: 'custom' },
      }),
      context,
    )
    expect(invalid.status).toBe(400)
  })

  it('requires each 用户上传 resource to have task-owned metadata in the same explicit slot', async () => {
    const uploadedAudio = {
      ...confirmation,
      resources: {
        ...confirmation.resources,
        audio: { status: '用户上传' as const, treatment: 'sound.mp3' },
      },
    }
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const missing = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: uploadedAudio }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(missing.status).toBe(400)

    harness.repository.assets.push({
      id: 'asset-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'audio',
      filename: 'sound.mp3',
      mimeType: 'audio/mpeg',
      size: 3,
      storageKey: 'private-key',
      createdAt: new Date(),
    })
    const accepted = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: uploadedAudio }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(accepted.status).toBe(202)
  })

  it('returns confirmation without waiting for background event or build work', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    vi.spyOn(harness.repository, 'appendEvent').mockImplementationOnce(() => new Promise(() => undefined))

    const outcome = await Promise.race([
      harness.handlers
        .confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), {
          params: Promise.resolve({ taskId: 'owned' }),
        })
        .then((response) => response.status),
      new Promise<number>((resolve) => setTimeout(() => resolve(599), 25)),
    ])

    expect(outcome).toBe(202)
    expect(harness.scheduled).toHaveLength(1)
    expect(harness.agent.build).not.toHaveBeenCalled()
  })

  it('reports authoritative building state during the after/event race', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    await harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), {
      params: Promise.resolve({ taskId: 'owned' }),
    })

    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    expect(await response.json()).toEqual({
      task: { phase: 'building', hasArtifact: false, artifactVersion: null, requirementBrief: null, confirmation },
      events: [],
    })
  })

  it('persists build-started before invoking the background build', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    let releaseEvent!: () => void
    vi.spyOn(harness.repository, 'appendEvent').mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseEvent = resolve)),
    )
    await harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), {
      params: Promise.resolve({ taskId: 'owned' }),
    })

    const background = harness.scheduled[0]()
    await Promise.resolve()
    expect(harness.agent.build).not.toHaveBeenCalled()
    releaseEvent()
    await background
    expect(harness.agent.build).toHaveBeenCalledOnce()
  })

  it('bounds a hung build-started event before continuing the background build', async () => {
    vi.useFakeTimers()
    try {
      harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
      vi.spyOn(harness.repository, 'appendEvent').mockImplementationOnce(() => new Promise(() => undefined))
      await harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), {
        params: Promise.resolve({ taskId: 'owned' }),
      })

      const background = harness.scheduled[0]()
      await Promise.resolve()
      expect(harness.agent.build).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(10)
      await background
      expect(harness.agent.build).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('redacts and revalidates all credential-shaped confirmation fields before the atomic claim', async () => {
    const otherSecret = 'sk-1234567890abcdefghijklmnop'
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        confirmation: { ...confirmation, gameplay: `Leaked ${otherSecret}` },
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(202)
    expect(harness.repository.tasks.get('owned')?.phase).toBe('building')
    expect(harness.repository.tasks.get('owned')?.confirmation?.gameplay).toBe('Leaked [REDACTED]')
    expect(JSON.stringify(harness.repository.tasks.get('owned'))).not.toContain(otherSecret)
  })

  it('hard-fails an exact caller-key echo in user confirmation before sanitization or claim', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        confirmation: { ...confirmation, gameplay: 'Leaked sk-test-secret' },
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(400)
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
    expect(harness.repository.tasks.get('owned')?.confirmation).toBeNull()
  })

  it('rejects a confirmed payload when redaction makes a structured field invalid', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        confirmation: { ...confirmation, storeUrl: 'https://sk-1234567890abcdefghijklmnop' },
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(400)
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
    expect(harness.repository.tasks.get('owned')?.confirmation).toBeNull()
  })

  it('publishes an artifact only after successful validation and storage', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(202)
    expect(harness.repository.tasks.get('owned')?.latestArtifactKey).toBeNull()
    await harness.scheduled[0]()

    const task = harness.repository.tasks.get('owned')
    expect(task?.phase).toBe('ready')
    expect(task?.latestArtifactKey).toMatch(/^users\/user-1\/tasks\/owned\/random-\d+\/playable\.html$/)
    expect([...harness.artifacts.keys()].sort()).toEqual([
      expect.stringMatching(/asset-manifest\.json$/),
      expect.stringMatching(/playable\.html$/),
      expect.stringMatching(/production-config\.json$/),
      expect.stringMatching(/validation-report\.json$/),
    ])
    expect(harness.repository.latestAssignments).toHaveLength(1)
    expect(harness.repository.builds).toEqual([
      expect.objectContaining({ status: 'succeeded', artifactKey: task?.latestArtifactKey }),
    ])
  })

  it('loads owned private asset bytes for the build and persists the returned truthful manifest', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = {
      ...confirmation,
      resources: {
        ...confirmation.resources,
        audio: { status: '用户上传', treatment: '使用上传的音频' },
      },
    }
    const storageKey = 'users/user-1/tasks/owned/assets/asset-1'
    harness.repository.assets.push({
      id: 'asset-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'audio',
      filename: 'sound.mp3',
      mimeType: 'audio/mpeg',
      size: 3,
      storageKey,
      createdAt: new Date(0),
    })
    const referenceStorageKey = 'users/user-1/tasks/owned/assets/reference-1'
    harness.repository.assets.push({
      id: 'reference-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 3,
      storageKey: referenceStorageKey,
      createdAt: new Date(0),
    })
    harness.artifacts.set(storageKey, new Uint8Array([1, 2, 3]))
    harness.artifacts.set(referenceStorageKey, new Uint8Array([4, 5, 6]))
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: '<script>window.__PLAYABLE__={}</script>',
      assetManifest: {
        ...createAssetSourceManifest(confirmation, []),
        assets: [
          {
            id: 'asset-1',
            slot: 'audio',
            filename: 'sound.mp3',
            mimeType: 'audio/mpeg',
            size: 3,
            workspacePath: 'user-assets/audio/asset-1-sound.mp3',
          },
        ],
        entrypoint: 'playable.html',
      },
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'asset-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(harness.agent.build).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ id: 'asset-1', bytes: new Uint8Array([1, 2, 3]) })],
      }),
    )
    expect(harness.artifactStore.get).not.toHaveBeenCalledWith(referenceStorageKey)
    const manifest = new TextDecoder().decode(
      harness.artifacts.get('users/user-1/tasks/owned/asset-build/asset-manifest.json'),
    )
    expect(manifest).toContain('user-assets/audio/asset-1-sound.mp3')
    expect(manifest).not.toContain(storageKey)
    expect(manifest).not.toContain('sk-test-secret')
  })

  it('fails safely when a legacy build reaches the worker with AI-generated media', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = {
      ...confirmation,
      resources: {
        ...confirmation.resources,
        tileFaces: { status: '待生成', treatment: '生成农场动物牌面' },
      },
    }
    const mediaGenerator = vi.fn(async () => [])

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'generated-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
      mediaGenerator,
    })

    expect(mediaGenerator).not.toHaveBeenCalled()
    expect(harness.agent.build).not.toHaveBeenCalled()
    expect(task.phase).toBe('failed')
  })

  it('marks a failed build without replacing the last published artifact', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    task.latestArtifactKey = 'users/user-1/tasks/owned/old/playable.html'
    vi.mocked(harness.agent.build).mockRejectedValueOnce(new Error('provider secret sk-build-secret'))

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'new-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(task.latestArtifactKey).toBe('users/user-1/tasks/owned/old/playable.html')
    expect(harness.repository.latestAssignments).toHaveLength(0)
    expect(JSON.stringify(harness.repository.events)).not.toContain('provider secret')
    expect(JSON.stringify(harness.repository.events)).not.toContain('sk-build-secret')
  })

  it('rejects credential-bearing build output before writing any artifact', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: '<script>window.__PLAYABLE__="sk-test-secret"</script>',
      validation: createValidationReport({ bytes: 52, offlineResources: true, responsiveViewport: true }),
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'new-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(harness.artifactStore.put).not.toHaveBeenCalled()
    expect(JSON.stringify(harness.repository.events)).not.toContain('sk-test-secret')
  })

  it('does not corrupt or reject CSS and URL text that only resembles a short key fragment', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    const html =
      '<style>.x{mask-image:none;-webkit-mask-size:cover}</style><script>window.__PLAYABLE__={name:"sk-chase",url:"https://example.com/task-1234"}</script>'
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html,
      validation: createValidationReport({ bytes: html.length, offlineResources: true, responsiveViewport: true }),
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'safe-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('ready')
    expect(new TextDecoder().decode(harness.artifacts.get('users/user-1/tasks/owned/safe-build/playable.html'))).toBe(
      html,
    )
  })

  it('rejects a realistic non-caller secret in generated HTML', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    const otherSecret = 'sk-1234567890abcdefghijklmnop'
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: `<script>window.__PLAYABLE__={secret:"${otherSecret}"}</script>`,
      validation: createValidationReport({ bytes: 72, offlineResources: true, responsiveViewport: true }),
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'leaked-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(harness.artifactStore.put).not.toHaveBeenCalled()
  })

  it('moves a validating task to failed and emits a terminal event when publication loses its compare-and-set', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.spyOn(harness.repository, 'publishArtifact').mockResolvedValueOnce(false)

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'new-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(harness.repository.events.at(-1)).toMatchObject({ type: 'build_failed', phase: 'failed' })
  })

  it('still attempts the terminal event when marking a failed build also fails', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockRejectedValueOnce(new Error('private provider error'))
    vi.spyOn(harness.repository, 'markFailed').mockRejectedValueOnce(new Error('database error'))

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'new-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(harness.repository.events.at(-1)).toMatchObject({ type: 'build_failed', phase: 'failed' })
  })

  it('handles scheduler failure by failing the claim and emitting a terminal event', async () => {
    const repository = harness.repository
    repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const handlers = createPlayableTaskHandlers({
      authenticate: async () => 'user-1',
      readApiKey: async () => 'sk-test-secret',
      repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
      schedule: () => {
        throw new Error('scheduler unavailable')
      },
      generateId: () => 'build-id',
    })

    const response = await handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), {
      params: Promise.resolve({ taskId: 'owned' }),
    })

    expect(response.status).toBe(500)
    expect(repository.tasks.get('owned')?.phase).toBe('failed')
    expect(repository.events.at(-1)).toMatchObject({ type: 'build_failed', phase: 'failed' })
  })

  it('returns only allowlisted and redacted event fields', async () => {
    harness.repository.events.push({
      id: 'event-private',
      taskId: 'owned',
      type: 'build_failed',
      phase: 'failed',
      message: 'Failed with sk-1234567890abcdefghijklmnop',
      privateData: { blobUrl: 'https://private.public.blob.vercel-storage.com/path' },
      createdAt: new Date(0),
    })
    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(200)
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('sk-1234567890abcdefghijklmnop')
    expect(serialized).not.toContain('blob.vercel-storage.com')
    expect(serialized).not.toContain('privateData')
    expect(serialized).not.toContain('"taskId"')
  })

  it('streams owned ready artifacts with strict iframe headers and no Blob URL', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.latestArtifactKey = 'users/user-1/tasks/owned/build/playable.html'
    harness.artifacts.set(task.latestArtifactKey, new TextEncoder().encode('<html>safe</html>'))

    const inline = await harness.handlers.artifact(request('/api/playable-tasks/owned/artifact?kind=playable'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const download = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable&download=1'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(inline.status).toBe(200)
    expect(await inline.text()).toBe('<html>safe</html>')
    expect(inline.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(inline.headers.get('content-disposition')).toBe('inline; filename="playable.html"')
    expect(inline.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; sandbox allow-scripts; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
    )
    expect(inline.headers.get('x-content-type-options')).toBe('nosniff')
    expect(inline.headers.get('cache-control')).toBe('private, no-store')
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="playable.html"')
    expect(download.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'",
    )
    expect(await download.text()).toBe('<html>safe</html>')
    expect(JSON.stringify([...inline.headers])).not.toContain('blob.vercel-storage.com')
  })

  it('exposes the complete delivery set immediately after a successful build', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.confirmation = confirmation
    task.latestArtifactKey = 'users/user-1/tasks/owned/build/playable.html'
    harness.artifacts.set(task.latestArtifactKey, new TextEncoder().encode('<html>preview</html>'))
    harness.artifacts.set(
      'users/user-1/tasks/owned/build/production-config.json',
      new TextEncoder().encode('{"core":{}}'),
    )

    const playable = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable&download=1'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(playable.status).toBe(200)

    const config = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=config&download=1'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(config.status).toBe(200)
    expect(config.headers.get('content-disposition')).toBe('attachment; filename="production-config.json"')
    expect(await config.text()).toBe('{"core":{}}')

    expect(task.latestArtifactKey).toBe('users/user-1/tasks/owned/build/playable.html')
  })

  it('lists successful versions and streams a selected historical artifact', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.latestArtifactKey = 'users/user-1/tasks/owned/build-2/playable.html'
    harness.repository.builds.push(
      {
        id: 'build-1',
        taskId: 'owned',
        status: 'succeeded',
        confirmation,
        artifactKey: 'users/user-1/tasks/owned/build-1/playable.html',
        createdAt: new Date(1),
        completedAt: new Date(2),
      },
      {
        id: 'failed-build',
        taskId: 'owned',
        status: 'failed',
        confirmation,
        artifactKey: null,
        createdAt: new Date(3),
        completedAt: new Date(4),
      },
      {
        id: 'build-2',
        taskId: 'owned',
        status: 'succeeded',
        confirmation,
        artifactKey: task.latestArtifactKey,
        createdAt: new Date(5),
        completedAt: new Date(6),
      },
    )
    harness.artifacts.set(
      'users/user-1/tasks/owned/build-1/playable.html',
      new TextEncoder().encode('<html>version one</html>'),
    )

    const versions = await harness.handlers.versions(request('/api/playable-tasks/owned/versions'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const versionsBody = await versions.json()
    expect(versionsBody).toEqual({
      builds: [
        expect.objectContaining({ id: 'build-1', status: 'succeeded', version: 1, current: false }),
        expect.objectContaining({ id: 'failed-build', status: 'failed', version: null, current: false }),
        expect.objectContaining({ id: 'build-2', status: 'succeeded', version: 2, current: true }),
      ],
    })
    expect(JSON.stringify(versionsBody)).not.toContain('artifactKey')
    expect(JSON.stringify(versionsBody)).not.toContain('confirmation')
    expect(JSON.stringify(versionsBody)).not.toContain('users/user-1')

    const historical = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable&version=build-1'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(historical.status).toBe(200)
    expect(await historical.text()).toBe('<html>version one</html>')

    const failedVersion = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable&version=failed-build'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(failedVersion.status).toBe(404)
  })

  it.each(['failed', 'validating'] as const)(
    'keeps the latest successful artifact reachable while the current phase is %s',
    async (phase) => {
      const task = harness.repository.tasks.get('owned')!
      task.phase = phase
      task.latestArtifactKey = 'users/user-1/tasks/owned/old/playable.html'
      harness.artifacts.set(task.latestArtifactKey, new TextEncoder().encode('<html>previous</html>'))

      const response = await harness.handlers.artifact(request('/api/playable-tasks/owned/artifact?kind=playable'), {
        params: Promise.resolve({ taskId: 'owned' }),
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('<html>previous</html>')
    },
  )

  it('returns generic 404 responses for invalid artifact kinds and tasks without a published artifact', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const invalidKind = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=validation'),
      context,
    )
    const noArtifact = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable'),
      context,
    )

    expect(invalidKind.status).toBe(404)
    expect(noArtifact.status).toBe(404)
    expect(await invalidKind.json()).toEqual({ error: 'Not found' })
    expect(await noArtifact.json()).toEqual({ error: 'Not found' })
    expect(harness.artifactStore.get).not.toHaveBeenCalled()
  })
})

describe('PrivateVercelArtifactStore', () => {
  it('uses private Blob access and never returns provider URLs', async () => {
    const sourceStream = byteStream(new TextEncoder().encode('artifact'))
    const blobClient: PrivateBlobClient = {
      put: vi.fn(async () => ({
        url: 'https://private.public.blob.vercel-storage.com/secret',
        pathname: 'users/u/tasks/t/b/playable.html',
      })),
      get: vi.fn(async () => ({ stream: sourceStream })),
      del: vi.fn(async () => undefined),
    }
    const store = new PrivateVercelArtifactStore(blobClient)

    await expect(store.put('users/u/tasks/t/b/playable.html', 'artifact', 'text/html')).resolves.toBeUndefined()
    const stream = await store.get('users/u/tasks/t/b/playable.html')
    expect(stream).toBe(sourceStream)
    await expect(new Response(stream).text()).resolves.toBe('artifact')
    expect(blobClient.put).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html', 'artifact', {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'text/html',
    })
    expect(blobClient.get).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html', { access: 'private' })
    await expect(store.delete('users/u/tasks/t/b/playable.html')).resolves.toBeUndefined()
    expect(blobClient.del).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html')
  })
})
