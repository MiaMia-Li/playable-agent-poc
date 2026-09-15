import { sourceTemplateFile } from '@/lib/playable/build-skill'
import { readFile } from 'node:fs/promises'
import { sourceTemplateIds } from '@/lib/playable/types'
import { templatePrompts } from '@/lib/playable/template-catalog'
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
  RevisionPlan,
  RevisionProposal,
} from '@/lib/playable/schemas'
import { PlayableAgentError, type PlayableAgentAdapter } from '@/lib/playable/playable-agent-adapter'
import type { PlayableAsset } from '@/lib/playable/task-assets'
import type { GameplayAnnotation } from '@/lib/playable/schemas'
import { MATCH_REFERENCE_DIFFERENCE } from '@/lib/playable/schemas'
import {
  createAssetSourceManifest,
  createProductionConfig,
  createValidationReport,
} from '@/lib/playable/production-contract'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import type { ReferenceImageAnalysis } from '@/lib/playable/reference-image-analyst'
import { PlayableBuildExecutionError } from '@/lib/playable/sandbox-runner'
import { VIDEO_ANALYSIS_PIPELINE_VERSION } from '@/lib/playable/video-gameplay-analyst'

const confirmation: ConfirmationProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] },
  visualDirection: 'custom',
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

const patchRevision: RevisionPlan = {
  strategy: 'patch',
  summary: '移除顶部进度标题',
  changes: ['移除顶部“下落补位 0/4”标题'],
  preserved: ['核心玩法', '素材和结束卡'],
}

const gameplayBlueprint: GameplayBlueprint = {
  version: 4,
  timeline: [],
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
  audio: [],
  intentDivergence: [],
  visualSpec: {
    artStyle: '卡通风格',
    palette: [],
    background: '',
    layout: [],
    uiComponents: [],
    entityLooks: [],
    effects: [],
  },
  keyframes: [],
  uncertainties: [],
  overallConfidence: 0.88,
}

const referenceImageAnalysis: ReferenceImageAnalysis = {
  version: 1,
  images: [
    {
      assetId: 'image-1',
      visualSummary: '竖屏卡通棋盘',
      layoutAndUi: ['顶部目标区', '中央棋盘'],
      visibleText: ['PLAY'],
      gameplayClues: ['点击配对'],
      uncertainties: ['失败条件未知'],
    },
  ],
  crossImageDirection: {
    visual: '明亮卡通',
    layoutAndUi: '顶部状态区与中央棋盘',
    gameplay: '点击配对',
    uncertainties: ['结束流程未知'],
  },
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
      pendingRevision: null,
      latestArtifactKey: null,
      activeReferenceVideoAssetId: null,
      gameplayAnnotations: [],
    }
    this.tasks.set(task.id, task)
    return task
  }

  async updateGameplayAnnotations(taskId: string, userId: string, annotations: GameplayAnnotation[]): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task) return false
    task.gameplayAnnotations = annotations
    return true
  }

  async setActiveReferenceVideo(taskId: string, userId: string, assetId: string | null): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task) return false
    task.activeReferenceVideoAssetId = assetId
    return true
  }

  async findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined> {
    const task = this.tasks.get(taskId)
    return task?.userId === userId ? task : undefined
  }

  async renameOwnedTask(taskId: string, userId: string, title: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task) return false
    task.title = title
    return true
  }

  async deleteOwnedTask(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task) return false
    this.tasks.delete(taskId)
    return true
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
    if (
      !task ||
      !['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)
    )
      return false
    task.requirementBrief = brief
    return true
  }

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'awaiting_confirmation'
    task.confirmation = confirmation
    task.pendingRevision = null
    return true
  }

  async setAwaitingRevision(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    revision: RevisionProposal,
  ): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'awaiting_revision_confirmation'
    task.confirmation = confirmation
    task.pendingRevision = revision
    return true
  }

  async clearPendingRevision(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)) return false
    task.phase = 'ready'
    task.pendingRevision = null
    return true
  }

  async setDraft(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (
      !task ||
      !['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(task.phase)
    )
      return false
    task.phase = 'draft'
    task.pendingRevision = null
    return true
  }

  async claimBuild(
    taskId: string,
    userId: string,
    value: ConfirmationProposal,
    buildId: string,
    revision?: RevisionProposal,
  ): Promise<PlayableTaskRecord | undefined> {
    const task = await this.findOwnedTask(taskId, userId)
    if (
      !task ||
      !(revision
        ? ['awaiting_revision_confirmation', 'failed'].includes(task.phase)
        : ['awaiting_confirmation', 'failed'].includes(task.phase))
    )
      return
    task.phase = 'building'
    task.confirmation = value
    task.pendingRevision = revision ?? null
    task.updatedAt = new Date()
    this.builds.push({
      id: buildId,
      taskId,
      status: 'building',
      confirmation: value,
      revision: revision ?? null,
      artifactKey: null,
      createdAt: new Date(),
    })
    return { ...task }
  }

  async compareAndSetPhase(
    taskId: string,
    buildId: string,
    expected: PlayableTaskRecord['phase'],
    next: PlayableTaskRecord['phase'],
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    const build = this.builds.find((candidate) => candidate.taskId === taskId && candidate.id === buildId)
    if (!task || task.phase !== expected || (build && build.status !== 'building')) return false
    task.phase = next
    return true
  }

  async savePreviewArtifact(
    taskId: string,
    buildId: string,
    artifactKey: string,
    validation: unknown,
    expectedStatus: 'building' | 'failed' = 'building',
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    const build = this.builds.find((candidate) => candidate.taskId === taskId && candidate.id === buildId)
    if (
      !task ||
      !(expectedStatus === 'failed' ? ['failed'] : ['building', 'validating']).includes(task.phase) ||
      build?.status !== expectedStatus
    )
      return false
    build.artifactKey = artifactKey
    build.validation = validation
    task.latestArtifactKey = artifactKey
    task.latestValidation = validation
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
    task.pendingRevision = null
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
        revision: task.pendingRevision,
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

  async touchBuild(taskId: string, buildId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    const build = this.builds.find((candidate) => candidate.taskId === taskId && candidate.id === buildId)
    if (!task || !['building', 'validating'].includes(task.phase) || (build && build.status !== 'building'))
      return false
    task.updatedAt = new Date()
    return true
  }

  async failStaleBuild(taskId: string, userId: string, staleBefore: Date): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['building', 'validating'].includes(task.phase) || !task.updatedAt || task.updatedAt >= staleBefore)
      return false
    task.phase = 'failed'
    task.updatedAt = new Date()
    const build = this.builds
      .filter((candidate) => candidate.taskId === taskId && candidate.status === 'building')
      .at(-1)
    if (build) {
      build.status = 'failed'
      build.completedAt = new Date()
    }
    return true
  }

  async markFailed(taskId: string, buildId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    const build = this.builds.find((candidate) => candidate.taskId === taskId && candidate.id === buildId)
    if (!task || !['building', 'validating'].includes(task.phase) || (build && build.status !== 'building'))
      return false
    task.phase = 'failed'
    if (build) {
      build.status = 'failed'
      build.completedAt = new Date()
    }
    return true
  }

  async listBuilds(taskId: string): Promise<PlayableBuildRecord[]> {
    return this.builds.filter((build) => build.taskId === taskId)
  }

  async listBuildsForTasks(taskIds: string[]): Promise<PlayableBuildRecord[]> {
    return this.builds.filter((build) => taskIds.includes(build.taskId))
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

  async claimVideoAnalysis(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
    rerun?: boolean
  }): Promise<{ analysis: PlayableVideoAnalysisRecord; claimed: boolean }> {
    const { rerun = false, ...values } = input
    const latest = this.videoAnalyses
      .filter(
        (candidate) =>
          candidate.assetId === input.assetId &&
          candidate.pipelineVersion === input.pipelineVersion &&
          candidate.model === input.model,
      )
      .at(-1)
    if (latest && latest.status !== 'failed' && !(rerun && latest.status === 'succeeded')) {
      return { analysis: latest, claimed: false }
    }
    const analysis: PlayableVideoAnalysisRecord = {
      ...values,
      attempt: (latest?.attempt ?? 0) + 1,
      status: 'pending',
      blueprint: null,
      keyframeStatus: null,
      keyframeImages: null,
      mediaResolution: null,
      intentText: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: null,
    }
    this.videoAnalyses.push(analysis)
    return { analysis, claimed: true }
  }

  async findLatestVideoAnalysis(
    taskId: string,
    pipelineVersion: string,
  ): Promise<PlayableVideoAnalysisRecord | undefined> {
    return this.videoAnalyses
      .filter((analysis) => analysis.taskId === taskId && analysis.pipelineVersion === pipelineVersion)
      .at(-1)
  }

  async findLatestSucceededVideoAnalysis(
    taskId: string,
    pipelineVersion: string,
    assetId: string,
  ): Promise<PlayableVideoAnalysisRecord | undefined> {
    return this.videoAnalyses
      .filter(
        (analysis) =>
          analysis.taskId === taskId &&
          analysis.pipelineVersion === pipelineVersion &&
          analysis.assetId === assetId &&
          analysis.status === 'succeeded',
      )
      .at(-1)
  }

  async recordIntentComparison(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
    attempt: number
    blueprint: GameplayBlueprint
    mediaResolution: PlayableVideoAnalysisRecord['mediaResolution']
    intentText: string
    keyframeStatus: PlayableVideoAnalysisRecord['keyframeStatus']
    keyframeImages: PlayableVideoAnalysisRecord['keyframeImages']
  }): Promise<PlayableVideoAnalysisRecord | undefined> {
    const taken = this.videoAnalyses.some(
      (analysis) =>
        analysis.assetId === input.assetId &&
        analysis.pipelineVersion === input.pipelineVersion &&
        analysis.model === input.model &&
        analysis.attempt === input.attempt,
    )
    if (taken) return undefined
    const now = new Date()
    const analysis: PlayableVideoAnalysisRecord = {
      ...input,
      status: 'succeeded',
      errorCode: null,
      createdAt: now,
      completedAt: now,
    }
    this.videoAnalyses.push(analysis)
    return analysis
  }

  async updateVideoAnalysisStatus(id: string, status: PlayableVideoAnalysisRecord['status']): Promise<void> {
    const analysis = this.videoAnalyses.find((candidate) => candidate.id === id)
    if (analysis) analysis.status = status
  }

  async completeVideoAnalysis(
    id: string,
    blueprint: GameplayBlueprint,
    mediaResolution: PlayableVideoAnalysisRecord['mediaResolution'],
    intentText: string,
  ): Promise<void> {
    const analysis = this.videoAnalyses.find((candidate) => candidate.id === id)
    if (!analysis) return
    analysis.status = 'succeeded'
    analysis.blueprint = blueprint
    analysis.keyframeStatus = 'pending'
    analysis.keyframeImages = []
    analysis.mediaResolution = mediaResolution
    analysis.intentText = intentText
    analysis.completedAt = new Date()
  }

  async saveReferenceKeyframes(input: {
    assetId: string
    pipelineVersion: string
    model: string
    fromAttempt: number
    keyframes: GameplayBlueprint['keyframes']
    status: NonNullable<PlayableVideoAnalysisRecord['keyframeStatus']>
    images: NonNullable<PlayableVideoAnalysisRecord['keyframeImages']>
  }): Promise<void> {
    const keyframes = JSON.stringify(input.keyframes)
    for (const analysis of this.videoAnalyses) {
      if (
        analysis.assetId === input.assetId &&
        analysis.pipelineVersion === input.pipelineVersion &&
        analysis.model === input.model &&
        analysis.status === 'succeeded' &&
        analysis.attempt >= input.fromAttempt &&
        JSON.stringify(analysis.blueprint?.keyframes) === keyframes
      ) {
        analysis.keyframeStatus = input.status
        analysis.keyframeImages = input.images
      }
    }
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
    pendingRevision: null,
    latestArtifactKey: null,
    activeReferenceVideoAssetId: null,
    gameplayAnnotations: [],
  })
  repository.tasks.set('foreign', {
    id: 'foreign',
    userId: 'user-2',
    prompt: 'Secret task',
    phase: 'ready',
    requirementBrief: null,
    confirmation,
    pendingRevision: null,
    latestArtifactKey: 'users/user-2/tasks/foreign/build/playable.html',
    activeReferenceVideoAssetId: null,
    gameplayAnnotations: [],
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
  const videoAnalyst = {
    model: 'gemini-test',
    analyze: vi.fn(async () => ({ blueprint: gameplayBlueprint, mediaResolution: 'high' as const })),
    compareIntent: vi.fn(async (): Promise<GameplayBlueprint['intentDivergence']> => []),
  }
  const imageAnalyst = { analyze: vi.fn(async () => referenceImageAnalysis) }
  const keyframeExtractor = {
    extract: vi.fn(
      async (input: { seconds: number[] }): Promise<(Uint8Array | null)[] | 'unavailable'> =>
        input.seconds.map(() => new Uint8Array([255, 216, 255])),
    ),
  }
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
    videoAnalyst,
    imageAnalyst,
    keyframeExtractor,
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
    videoAnalyst,
    imageAnalyst,
    keyframeExtractor,
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

function referenceVideo(id: string): PlayableAsset {
  return {
    id,
    taskId: 'owned',
    userId: 'user-1',
    slot: 'referenceVideo',
    filename: `${id}.mp4`,
    mimeType: 'video/mp4',
    size: 1,
    storageKey: `${id}-key`,
    durationSeconds: 30,
    createdAt: new Date(),
  }
}

function storedAnnotation(id: string, assetId: string, value: string): GameplayAnnotation {
  return {
    id,
    assetId,
    source: 'user',
    value,
    evidence: [{ startSeconds: 3, endSeconds: 4, observation: value }],
    confidence: 1,
    origin: 'chat',
  }
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
      harness.handlers.library(request('/api/playable-tasks/library')),
      harness.handlers.create(request('/api/playable-tasks', 'POST', { prompt: 'game' })),
      harness.handlers.rename(request('/api/playable-tasks/owned', 'PATCH', { title: 'Renamed' }), context),
      harness.handlers.remove(request('/api/playable-tasks/owned', 'DELETE'), context),
      harness.handlers.message(request('/api/playable-tasks/owned/messages', 'POST', { message: 'hello' }), context),
      harness.handlers.analysis(request('/api/playable-tasks/owned/analysis'), context),
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
      harness.handlers.events(request('/api/playable-tasks/owned/events'), context),
      harness.handlers.artifact(request('/api/playable-tasks/owned/artifact?kind=playable'), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 401])
  })

  it('analyses the named reference video and persists a gameplay blueprint before requirement planning', async () => {
    const video: PlayableAsset = {
      id: 'video-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'private-video',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    harness.artifacts.set(video.storageKey, new Uint8Array([1]))
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    const queued = await harness.handlers.analysis(
      request('/api/playable-tasks/owned/analysis', 'POST', { assetId: video.id }),
      context,
    )

    expect(queued.status).toBe(202)
    // Naming the video is also what makes it the active one, which is the
    // binding the blueprint and its annotations are read through afterwards.
    expect(harness.repository.tasks.get('owned')?.activeReferenceVideoAssetId).toBe(video.id)
    expect(harness.scheduled).toHaveLength(1)
    await harness.scheduled[0]()
    expect(harness.videoAnalyst.analyze).toHaveBeenCalledOnce()
    await expect(
      harness.repository.findLatestVideoAnalysis('owned', VIDEO_ANALYSIS_PIPELINE_VERSION),
    ).resolves.toMatchObject({
      status: 'succeeded',
      blueprint: gameplayBlueprint,
      mediaResolution: 'high',
    })

    const messageResponse = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '参考视频制作试玩' }),
      context,
    )
    await messageResponse.text()
    expect(harness.agent.proposeConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ gameplayBlueprint: expect.objectContaining(gameplayBlueprint) }),
      expect.any(Object),
    )
  })

  // Keyframes are cut in their own background work after the analysis, and
  // served only for the active video's current analysis (spec §3).
  it('cuts reference keyframes after the analysis and serves them for the active video only', async () => {
    const video = referenceVideo('video-keyframes')
    harness.repository.assets.push(video)
    harness.artifacts.set(video.storageKey, new Uint8Array([1]))
    harness.videoAnalyst.analyze.mockResolvedValueOnce({
      blueprint: {
        ...gameplayBlueprint,
        keyframes: [
          { seconds: 2, focus: '主界面布局' },
          { seconds: 20, focus: '结算页' },
        ],
      },
      mediaResolution: 'high',
    })
    harness.keyframeExtractor.extract.mockResolvedValueOnce([new Uint8Array([255, 216, 255]), null])
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    await harness.handlers.analysis(
      request('/api/playable-tasks/owned/analysis', 'POST', { assetId: video.id }),
      context,
    )
    await harness.scheduled[0]()
    // The analysis queues the extraction rather than running it on its own clock.
    expect(harness.scheduled).toHaveLength(2)
    const pending = await (
      await harness.handlers.analysis(request('/api/playable-tasks/owned/analysis'), context)
    ).json()
    expect(pending.analysis.keyframeStatus).toBe('pending')

    await harness.scheduled[1]()
    expect(harness.keyframeExtractor.extract).toHaveBeenCalledWith(expect.objectContaining({ seconds: [2, 20] }))
    const ready = await (await harness.handlers.analysis(request('/api/playable-tasks/owned/analysis'), context)).json()
    expect(ready.analysis.keyframeStatus).toBe('succeeded')
    expect(ready.analysis.keyframes).toEqual([
      { index: 0, seconds: 2, focus: '主界面布局', available: true },
      { index: 1, seconds: 20, focus: '结算页', available: false },
    ])

    const keyframe = (index: string) =>
      harness.handlers.analysisKeyframe(request(`/api/playable-tasks/owned/analysis/keyframes/${index}`), {
        params: Promise.resolve({ taskId: 'owned', index }),
      })
    const served = await keyframe('0')
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]))
    expect((await keyframe('1')).status).toBe(404)
    expect((await keyframe('../x')).status).toBe(404)
  })

  // An exact route never reads the blueprint, so the server lifts it rather
  // than trusting the table to have done so (spec §4.2).
  it('builds a reference-matching confirmation on an approximate route, and only with a blueprint', async () => {
    const task = harness.repository.tasks.get('owned')!
    const confirmAs = async (visualDirection: 'match_reference' | 'custom') => {
      task.phase = 'awaiting_confirmation'
      task.confirmation = confirmation
      const response = await harness.handlers.confirm(
        request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: { ...confirmation, visualDirection } }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(response.status).toBe(202)
      await harness.scheduled.at(-1)!()
      return vi.mocked(harness.agent.build).mock.lastCall![0].confirmation
    }

    // No blueprint yet: there is nothing to match, so the route stays exact.
    expect(await confirmAs('match_reference')).toMatchObject({
      visualDirection: 'custom',
      routing: { match: 'exact', differences: [] },
    })

    const video = referenceVideo('video-visuals')
    harness.repository.assets.push(video)
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', video.id)
    harness.repository.videoAnalyses.push({
      id: 'analysis-visuals',
      taskId: 'owned',
      assetId: video.id,
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: 'model',
      attempt: 1,
      mediaResolution: 'high',
      intentText: null,
      blueprint: gameplayBlueprint,
      keyframeStatus: 'succeeded',
      keyframeImages: [],
      errorCode: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })

    expect(await confirmAs('match_reference')).toMatchObject({
      visualDirection: 'match_reference',
      routing: { match: 'approximate', differences: [MATCH_REFERENCE_DIFFERENCE] },
    })
  })

  it('hands a reference-matching build the keyframes of the active video', async () => {
    const task = harness.repository.tasks.get('owned')!
    const video = referenceVideo('video-keyframe-build')
    harness.repository.assets.push(video)
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', video.id)
    harness.artifacts.set('keyframe-1', new Uint8Array([255, 216, 255]))
    harness.repository.videoAnalyses.push({
      id: 'analysis-keyframe-build',
      taskId: 'owned',
      assetId: video.id,
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: 'model',
      attempt: 1,
      mediaResolution: 'high',
      intentText: null,
      blueprint: { ...gameplayBlueprint, keyframes: [{ seconds: 3, focus: '主界面布局' }] },
      keyframeStatus: 'succeeded',
      keyframeImages: [{ keyframeIndex: 0, storageKey: 'keyframe-1', mimeType: 'image/jpeg' }],
      errorCode: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })
    const confirmAs = async (visualDirection: 'match_reference' | 'custom') => {
      task.phase = 'awaiting_confirmation'
      task.confirmation = confirmation
      await harness.handlers.confirm(
        request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: { ...confirmation, visualDirection } }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      await harness.scheduled.at(-1)!()
      return vi.mocked(harness.agent.build).mock.lastCall![0]
    }

    expect((await confirmAs('match_reference')).referenceKeyframes).toEqual([
      { seconds: 3, focus: '主界面布局', mimeType: 'image/jpeg', bytes: new Uint8Array([255, 216, 255]) },
    ])
    // Borrowing the gameplay only: the build gets no visual target to copy.
    expect((await confirmAs('custom')).referenceKeyframes).toBeUndefined()
  })

  it('does not pass an older video blueprint after a new reference video is uploaded', async () => {
    harness.repository.assets.push(
      {
        id: 'video-old',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceVideo',
        filename: 'old.mp4',
        mimeType: 'video/mp4',
        size: 1,
        storageKey: 'old-video',
        durationSeconds: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'video-new',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceVideo',
        filename: 'new.mp4',
        mimeType: 'video/mp4',
        size: 1,
        storageKey: 'new-video',
        durationSeconds: null,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    )
    harness.repository.videoAnalyses.push({
      id: 'analysis-old',
      taskId: 'owned',
      assetId: 'video-old',
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: 'model',
      attempt: 1,
      mediaResolution: null,
      intentText: null,
      blueprint: gameplayBlueprint,
      keyframeStatus: null,
      keyframeImages: null,
      errorCode: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:01:00Z'),
    })

    await harness.repository.setActiveReferenceVideo('owned', 'user-1', 'video-new')

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '使用新视频制作试玩' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    await response.text()

    expect(harness.agent.proposeConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ gameplayBlueprint: undefined }),
      expect.any(Object),
    )
  })

  it('replaces screenshot batches, inherits a follow-up, reuses selected history and freezes the build snapshot', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.confirmation = confirmation
    task.latestArtifactKey = 'base/playable.html'
    harness.repository.builds.push({
      id: 'base',
      taskId: 'owned',
      status: 'succeeded',
      confirmation,
      artifactKey: task.latestArtifactKey,
      createdAt: new Date(1),
    })
    harness.artifacts.set(task.latestArtifactKey, new TextEncoder().encode('<html>base</html>'))
    for (const id of ['a', 'b', 'c']) {
      harness.repository.assets.push({
        id,
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceImage',
        filename: `${id}.png`,
        mimeType: 'image/png',
        size: 1,
        storageKey: `images/${id}`,
        durationSeconds: null,
        createdAt: new Date(),
      })
      harness.artifacts.set(`images/${id}`, new Uint8Array([id.charCodeAt(0)]))
    }
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValue({
      kind: 'revision',
      message: '修改',
      reasoning: '修复截图问题',
      revision: patchRevision,
      confirmation,
    })
    const send = async (body: Record<string, unknown>) => {
      const result = await harness.handlers.message(request('/api/playable-tasks/owned/messages', 'POST', body), {
        params: Promise.resolve({ taskId: 'owned' }),
      })
      expect(await result.text()).toContain('"type":"revision"')
    }
    await send({ message: '最底部多出红中', attachmentIds: ['a', 'b'] })
    expect(task.confirmation!.referenceImages?.map((ref) => ref.assetId)).toEqual(['a', 'b'])
    await send({ message: '看新的顶部问题', attachmentIds: ['c'] })
    expect(task.confirmation!.referenceImages?.map((ref) => ref.assetId)).toEqual(['c'])
    await send({ message: '这个问题仍在' })
    expect(harness.agent.proposeConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachedAssetIds: ['c'],
        referenceImages: [
          expect.objectContaining({
            assetId: 'c',
            sourceVersion: 1,
            purpose: 'problem',
            description: '看新的顶部问题',
          }),
        ],
      }),
      expect.anything(),
    )
    await send({ message: '再对照第一张', referenceImageIds: ['a', 'c'] })
    const frozen = task.confirmation!.referenceImages!
    expect(frozen.map((ref) => ref.assetId)).toEqual(['a', 'c'])
    expect(frozen[0].description).toBe('最底部多出红中')
    const confirmed = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        revisionId: task.pendingRevision!.id,
        confirmation: { ...confirmation, referenceImages: [] },
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(confirmed.status).toBe(202)
    await harness.scheduled.at(-1)!()
    expect(harness.agent.build).toHaveBeenLastCalledWith(
      expect.objectContaining({
        referenceImages: [
          expect.objectContaining({ assetId: 'a', bytes: new Uint8Array([97]) }),
          expect.objectContaining({ assetId: 'c', bytes: new Uint8Array([99]) }),
        ],
        assets: [],
      }),
    )
    expect(
      harness.repository.messages
        .filter((message) => message.role === 'user')
        .map((message) => JSON.parse(message.content).referenceImages.map((ref: { assetId: string }) => ref.assetId)),
    ).toEqual([['a', 'b'], ['c'], ['c'], ['a', 'c']])
    await send({ message: '新的修改不参考截图', referenceImageIds: [] })
    expect(task.confirmation!.referenceImages).toBeUndefined()
  })

  it('rejects a reference screenshot owned by a different task', async () => {
    harness.repository.assets.push({
      id: 'foreign-image',
      taskId: 'other',
      userId: 'user-1',
      slot: 'referenceImage',
      filename: 'other.png',
      mimeType: 'image/png',
      size: 1,
      storageKey: 'other',
      durationSeconds: null,
      createdAt: new Date(),
    })
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '参考', referenceImageIds: ['foreign-image'] }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(await response.text()).toContain('"type":"error"')
    expect(harness.agent.proposeConfirmation).not.toHaveBeenCalled()
  })

  it('executes reference image inspection only when requested and returns private bytes to the agent tool loop', async () => {
    const image: PlayableAsset = {
      id: 'image-1',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceImage',
      filename: 'private-name.png',
      mimeType: 'image/png',
      size: 2,
      storageKey: 'private-image-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(image)
    harness.artifacts.set(image.storageKey, new Uint8Array([1, 2]))
    let toolResult: unknown
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      const toolCall = { name: 'inspect_reference_images' as const, assetIds: ['image-1'], assetId: null }
      options?.onProgress?.({ type: 'tool_started', toolCall })
      toolResult = await options?.executeTool?.(toolCall)
      options?.onProgress?.({ type: 'tool_completed', toolCall })
      return {
        kind: 'informational',
        message: '已分析参考图片。',
        reasoning: '图片提供了布局和玩法线索。',
        brief: createRequirementBrief(),
        tools: ['respond_to_user'],
      }
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', {
        message: '请参考这张图',
        attachmentIds: ['image-1'],
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(toolResult).toEqual(referenceImageAnalysis)
    expect(harness.imageAnalyst.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'owned',
        images: [{ assetId: 'image-1', mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }],
      }),
    )
    expect(events.filter((event) => String(event.type).startsWith('tool_'))).toEqual([
      { type: 'tool_started', tool: 'inspect_reference_images', message: '正在分析参考图片' },
      { type: 'tool_completed', tool: 'inspect_reference_images', message: '参考图片分析完成' },
      { type: 'tool_completed', tool: 'respond_to_user' },
    ])
    expect(JSON.stringify(events.filter((event) => String(event.type).startsWith('tool_')))).not.toContain('image-1')
    expect(JSON.stringify(events.filter((event) => String(event.type).startsWith('tool_')))).not.toContain(
      'private-name.png',
    )
    expect(JSON.stringify(events)).not.toContain('private-image-key')
  })

  it('restricts tools to this turn attachments and budgets one canonical call per paid tool type', async () => {
    const assets: PlayableAsset[] = [
      {
        id: 'image-a',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceImage',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 1,
        storageKey: 'image-a-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
      {
        id: 'image-b',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceImage',
        filename: 'b.png',
        mimeType: 'image/png',
        size: 1,
        storageKey: 'image-b-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
      {
        id: 'old-image',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'referenceImage',
        filename: 'old.png',
        mimeType: 'image/png',
        size: 1,
        storageKey: 'old-image-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
      ...['video-a', 'video-b'].map(
        (id): PlayableAsset => ({
          id,
          taskId: 'owned',
          userId: 'user-1',
          slot: 'referenceVideo',
          filename: `${id}.mp4`,
          mimeType: 'video/mp4',
          size: 1,
          storageKey: `${id}-key`,
          durationSeconds: null,
          createdAt: new Date(),
        }),
      ),
    ]
    harness.repository.assets.push(...assets)
    for (const asset of assets) harness.artifacts.set(asset.storageKey, new Uint8Array([1]))
    const results: unknown[] = []
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      for (const call of [
        { name: 'inspect_reference_images' as const, assetIds: ['image-b', 'image-a', 'image-a'], assetId: null },
        { name: 'inspect_reference_images' as const, assetIds: ['image-a', 'image-b'], assetId: null },
        { name: 'inspect_reference_images' as const, assetIds: ['image-a'], assetId: null },
        { name: 'inspect_reference_images' as const, assetIds: ['old-image'], assetId: null },
        { name: 'analyze_reference_video' as const, assetIds: [] as [], assetId: 'video-a' },
        { name: 'analyze_reference_video' as const, assetIds: [] as [], assetId: 'video-b' },
      ]) {
        results.push(await options?.executeTool?.(call))
      }
      return confirmationReply
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '分析本轮附件',
          attachmentIds: ['image-a', 'image-b', 'video-a', 'video-b', 'image-a'],
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(harness.imageAnalyst.analyze).toHaveBeenCalledOnce()
    expect(harness.imageAnalyst.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [expect.objectContaining({ assetId: 'image-a' }), expect.objectContaining({ assetId: 'image-b' })],
      }),
    )
    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual({ status: 'unavailable', reason: 'budget_exceeded' })
    expect(results[3]).toEqual({ status: 'unavailable', reason: 'asset_not_attached' })
    // Reading a blueprint is free, so the video tool carries no budget and the
    // second attached video answers for itself rather than being cut off.
    expect(results[4]).toEqual({ status: 'unavailable', reason: 'analysis_not_started' })
    expect(results[5]).toEqual({ status: 'unavailable', reason: 'analysis_not_started' })
  })

  it('rejects non-owned and wrong-slot assets requested by reference tools without reading private bytes', async () => {
    harness.repository.assets.push(
      {
        id: 'foreign-image',
        taskId: 'foreign',
        userId: 'user-2',
        slot: 'referenceImage',
        filename: 'foreign.png',
        mimeType: 'image/png',
        size: 1,
        storageKey: 'foreign-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
      {
        id: 'wrong-slot',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'audio',
        filename: 'audio.mp3',
        mimeType: 'audio/mpeg',
        size: 1,
        storageKey: 'audio-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
    )
    const outcomes: unknown[] = []
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      for (const assetIds of [['foreign-image'], ['wrong-slot']]) {
        outcomes.push(await options?.executeTool?.({ name: 'inspect_reference_images', assetIds, assetId: null }))
      }
      return {
        kind: 'informational',
        message: '无法分析指定图片。',
        reasoning: '指定素材不可用。',
        brief: createRequirementBrief(),
        tools: ['respond_to_user'],
      }
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '分析指定图片',
          attachmentIds: ['wrong-slot'],
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(outcomes).toEqual([
      { status: 'unavailable', reason: 'asset_not_attached' },
      { status: 'unavailable', reason: 'asset_unavailable' },
    ])
    expect(harness.imageAnalyst.analyze).not.toHaveBeenCalled()
    expect(harness.artifactStore.get).not.toHaveBeenCalled()
  })

  it('streams a static failed-tool event without exposing asset metadata or the underlying error', async () => {
    const image: PlayableAsset = {
      id: 'secret-asset-id',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceImage',
      filename: 'secret-filename.png',
      mimeType: 'image/png',
      size: 1,
      storageKey: 'secret-storage-path',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(image)
    harness.artifacts.set(image.storageKey, new Uint8Array([1]))
    harness.imageAnalyst.analyze.mockRejectedValueOnce(new Error('provider credential and private path'))
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      const toolCall = {
        name: 'inspect_reference_images' as const,
        assetIds: ['secret-asset-id'],
        assetId: null,
      }
      options?.onProgress?.({ type: 'tool_started', toolCall })
      await options?.executeTool?.(toolCall).catch(() => undefined)
      options?.onProgress?.({ type: 'tool_failed', toolCall })
      return {
        kind: 'informational',
        message: '参考图片暂时无法分析。',
        reasoning: '工具暂不可用。',
        brief: createRequirementBrief(),
        tools: ['respond_to_user'],
      }
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '分析图片' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const body = await response.text()

    expect(body).toContain('{"type":"tool_failed","tool":"inspect_reference_images","message":"参考图片分析暂不可用"}')
    expect(body).not.toContain('secret-asset-id')
    expect(body).not.toContain('secret-filename.png')
    expect(body).not.toContain('secret-storage-path')
    expect(body).not.toContain('provider credential')
  })

  it('reports the analysis upload already started instead of starting one itself', async () => {
    const video: PlayableAsset = {
      id: 'video-tool',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'video-tool-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    harness.artifacts.set(video.storageKey, new Uint8Array([1]))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', video.id)
    harness.repository.videoAnalyses.push({
      id: 'analysis-tool',
      taskId: 'owned',
      assetId: video.id,
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: 'model',
      attempt: 1,
      mediaResolution: 'high',
      intentText: null,
      blueprint: gameplayBlueprint,
      keyframeStatus: null,
      keyframeImages: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })
    let toolResult: unknown
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      toolResult = await options?.executeTool?.({
        name: 'analyze_reference_video',
        assetIds: [],
        assetId: 'video-tool',
      })
      return confirmationReply
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '分析视频再给方案',
          attachmentIds: ['video-tool'],
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(toolResult).toEqual({ status: 'succeeded', blueprint: gameplayBlueprint })
    // The tool is a lookup now. Holding the NDJSON stream open for a Gemini
    // round trip is exactly what this change removed, so the analyst must not
    // be reachable from the message path at all. The one thing a turn may
    // schedule is a text-only intent comparison, which never sends the video.
    await Promise.all(harness.scheduled.map((work) => work()))
    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
  })

  it('tells the agent no analysis exists yet rather than starting one', async () => {
    const video: PlayableAsset = {
      id: 'video-unstarted',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'video-unstarted-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    let toolResult: unknown
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      toolResult = await options?.executeTool?.({
        name: 'analyze_reference_video',
        assetIds: [],
        assetId: video.id,
      })
      return confirmationReply
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '分析视频',
          attachmentIds: [video.id],
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(toolResult).toEqual({ status: 'unavailable', reason: 'analysis_not_started' })
    expect(harness.repository.videoAnalyses).toHaveLength(0)
    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
  })

  it('claims a single analysis when two POSTs race for the same video', async () => {
    const video: PlayableAsset = {
      id: 'video-race',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'video-race-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    harness.artifacts.set(video.storageKey, new Uint8Array([1]))
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const post = () =>
      harness.handlers.analysis(request('/api/playable-tasks/owned/analysis', 'POST', { assetId: video.id }), context)

    const [first, second] = await Promise.all([post(), post()])
    await Promise.all(harness.scheduled.map((work) => work()))

    expect([first.status, second.status]).toEqual([202, 202])
    expect(harness.repository.videoAnalyses).toHaveLength(1)
    expect(harness.videoAnalyst.analyze).toHaveBeenCalledOnce()
  })

  // A degraded or plainly wrong result must not be final, but a plain POST is
  // idempotent on success so that upload retries never bill twice. Only an
  // explicit re-run crosses a succeeded row, and even it waits for a running one.
  it('starts a new attempt past a succeeded analysis only when a re-run is asked for', async () => {
    const video: PlayableAsset = {
      id: 'video-rerun',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'video-rerun-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    harness.artifacts.set(video.storageKey, new Uint8Array([1]))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', video.id)
    harness.repository.videoAnalyses.push({
      id: 'analysis-degraded',
      taskId: 'owned',
      assetId: video.id,
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: harness.videoAnalyst.model,
      attempt: 1,
      mediaResolution: 'default',
      intentText: null,
      blueprint: gameplayBlueprint,
      keyframeStatus: null,
      keyframeImages: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const post = (body: unknown) =>
      harness.handlers.analysis(request('/api/playable-tasks/owned/analysis', 'POST', body), context)

    const plain = await post({ assetId: video.id })
    expect(plain.status).toBe(200)
    expect(harness.repository.videoAnalyses).toHaveLength(1)

    const rerun = await post({ assetId: video.id, rerun: true })
    expect(rerun.status).toBe(202)
    // The previous blueprint rides along, so neither the card nor the agent
    // loses it while the re-run is in flight.
    await expect(rerun.json()).resolves.toMatchObject({
      analysis: { attempt: 2, status: 'pending', blueprint: gameplayBlueprint, mediaResolution: 'default' },
    })

    const whileRunning = await post({ assetId: video.id, rerun: true })
    expect(whileRunning.status).toBe(202)
    expect(harness.repository.videoAnalyses).toHaveLength(2)

    await Promise.all(harness.scheduled.map((work) => work()))
    expect(harness.videoAnalyst.analyze).toHaveBeenCalledOnce()
    await expect(
      harness.repository.findLatestVideoAnalysis('owned', VIDEO_ANALYSIS_PIPELINE_VERSION),
    ).resolves.toMatchObject({ attempt: 2, status: 'succeeded', mediaResolution: 'high' })
  })

  // Uploading first means the video is analysed before anyone says what they
  // want. The comparison has to catch up once they do, without watching the
  // video again and without touching what was observed.
  it('compares a finished analysis against intent that arrives later, leaving the observation untouched', async () => {
    const video = referenceVideo('video-intent')
    harness.repository.assets.push(video)
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', video.id)
    harness.repository.videoAnalyses.push({
      id: 'analysis-before-intent',
      taskId: 'owned',
      assetId: video.id,
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: harness.videoAnalyst.model,
      attempt: 1,
      mediaResolution: 'high',
      intentText: '',
      blueprint: gameplayBlueprint,
      keyframeStatus: null,
      keyframeImages: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })
    const divergence = [{ value: '视频是连连看，不是三消', confidence: 0.9, evidence: [] }]
    harness.videoAnalyst.compareIntent.mockResolvedValueOnce(divergence)
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValue({
      ...confirmationReply,
      brief: createRequirementBrief('我想做一个三消'),
    })
    const send = async () =>
      (
        await harness.handlers.message(
          request('/api/playable-tasks/owned/messages', 'POST', { message: '我想做一个三消' }),
          { params: Promise.resolve({ taskId: 'owned' }) },
        )
      ).text()

    await send()
    expect(harness.scheduled).toHaveLength(1)
    await harness.scheduled[0]()

    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
    expect(harness.videoAnalyst.compareIntent).toHaveBeenCalledWith(
      expect.objectContaining({ blueprint: gameplayBlueprint, intent: expect.stringContaining('三消') }),
    )
    await expect(
      harness.repository.findLatestVideoAnalysis('owned', VIDEO_ANALYSIS_PIPELINE_VERSION),
    ).resolves.toMatchObject({
      attempt: 2,
      status: 'succeeded',
      mediaResolution: 'high',
      intentText: expect.stringContaining('三消'),
      blueprint: { ...gameplayBlueprint, intentDivergence: divergence },
    })

    // The same intent again owes nothing.
    await send()
    expect(harness.scheduled).toHaveLength(1)
    expect(harness.videoAnalyst.compareIntent).toHaveBeenCalledOnce()
  })

  // Drafts come back without an asset id and are bound to the active video on
  // store. Showing the agent another video's annotations would let it rebind
  // them; replacing the whole list would erase them.
  it("replaces only the active video's annotations and shows the agent only those", async () => {
    harness.repository.assets.push(referenceVideo('video-a'), referenceVideo('video-b'))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', 'video-b')
    const task = harness.repository.tasks.get('owned')!
    task.gameplayAnnotations = [storedAnnotation('a-1', 'video-a', '旧视频第 3 秒是滑动')]
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      ...confirmationReply,
      annotations: [
        { value: '第 12 秒是长按', evidence: [{ startSeconds: 12, endSeconds: 12.5, observation: '长按' }] },
      ],
    })

    const body = await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '第 12 秒是长按' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(vi.mocked(harness.agent.proposeConfirmation).mock.calls[0][0].annotations).toEqual([])
    expect(task.gameplayAnnotations).toEqual([
      expect.objectContaining({ assetId: 'video-b', value: '第 12 秒是长按', source: 'user', confidence: 1 }),
      expect.objectContaining({ id: 'a-1', assetId: 'video-a' }),
    ])
    const events = body
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; annotations?: GameplayAnnotation[] })
    expect(events.find((event) => event.type === 'annotations')?.annotations).toEqual([
      expect.objectContaining({ assetId: 'video-b', value: '第 12 秒是长按' }),
    ])
  })

  it('lists and deletes annotations for the active video only', async () => {
    harness.repository.assets.push(referenceVideo('video-a'), referenceVideo('video-b'))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', 'video-b')
    const task = harness.repository.tasks.get('owned')!
    const active = storedAnnotation('b-1', 'video-b', '第 12 秒是长按')
    task.gameplayAnnotations = [storedAnnotation('a-1', 'video-a', '旧视频'), active]
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const call = (path: string, method = 'GET') => harness.handlers.annotations(request(path, method), context)

    const listed = await call('/api/playable-tasks/owned/annotations')
    await expect(listed.json()).resolves.toEqual({ annotations: [active] })

    const deleted = await call('/api/playable-tasks/owned/annotations?id=b-1', 'DELETE')
    expect(deleted.status).toBe(200)
    await expect(deleted.json()).resolves.toEqual({ annotations: [] })
    expect(task.gameplayAnnotations.map((annotation) => annotation.id)).toEqual(['a-1'])

    expect((await call('/api/playable-tasks/owned/annotations?id=b-1', 'DELETE')).status).toBe(404)
  })

  // A timeline correction is the user's own statement about the video, so it
  // is written straight to the list, bound to the active video.
  it('records a timeline correction for the active video', async () => {
    harness.repository.assets.push(referenceVideo('video-a'), referenceVideo('video-b'))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', 'video-b')
    const task = harness.repository.tasks.get('owned')!
    task.gameplayAnnotations = [storedAnnotation('a-1', 'video-a', '旧视频')]

    const response = await harness.handlers.annotations(
      request('/api/playable-tasks/owned/annotations', 'POST', {
        value: '第 12 秒是点击，不是长按',
        startSeconds: 12,
        endSeconds: 13,
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      annotations: [
        expect.objectContaining({
          assetId: 'video-b',
          origin: 'timeline',
          value: '第 12 秒是点击，不是长按',
          evidence: [{ startSeconds: 12, endSeconds: 13, observation: '第 12 秒是点击，不是长按' }],
        }),
      ],
    })
    expect(task.gameplayAnnotations.map((annotation) => annotation.assetId)).toEqual(['video-a', 'video-b'])
  })

  it('rejects a timeline correction without an active video or with an invalid range', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const post = (body: unknown) =>
      harness.handlers.annotations(request('/api/playable-tasks/owned/annotations', 'POST', body), context)
    expect((await post({ value: '点击', startSeconds: 1, endSeconds: 2 })).status).toBe(409)

    harness.repository.assets.push(referenceVideo('video-b'))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', 'video-b')
    expect((await post({ value: '点击', startSeconds: 3, endSeconds: 2 })).status).toBe(400)
    expect((await post({ value: '', startSeconds: 1, endSeconds: 2 })).status).toBe(400)
  })

  // The running turn read the list before the correction existed. Writing that
  // stale list back whole would erase the correction without a trace.
  it('keeps a timeline correction made while an agent turn was running', async () => {
    harness.repository.assets.push(referenceVideo('video-b'))
    await harness.repository.setActiveReferenceVideo('owned', 'user-1', 'video-b')
    const correction: GameplayAnnotation = {
      ...storedAnnotation('t-1', 'video-b', '第 12 秒是点击'),
      origin: 'timeline',
    }
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async () => {
      // A separate request stored the correction into a task object the
      // running turn does not hold.
      const current = harness.repository.tasks.get('owned')!
      harness.repository.tasks.set('owned', {
        ...current,
        gameplayAnnotations: [...current.gameplayAnnotations, correction],
      })
      return {
        ...confirmationReply,
        annotations: [
          { value: '第 3 秒是滑动', evidence: [{ startSeconds: 3, endSeconds: 4, observation: '滑动' }] },
          // An echo the agent was told not to send; it must not become a copy.
          { value: correction.value, evidence: correction.evidence },
        ],
      }
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '第 3 秒是滑动' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(harness.repository.tasks.get('owned')!.gameplayAnnotations).toEqual([
      expect.objectContaining({ id: 't-1', origin: 'timeline' }),
      expect.objectContaining({ assetId: 'video-b', value: '第 3 秒是滑动', origin: 'chat' }),
    ])
  })

  it('rejects video analysis tool calls for cross-user assets and non-referenceVideo slots', async () => {
    harness.repository.assets.push(
      {
        id: 'foreign-video',
        taskId: 'foreign',
        userId: 'user-2',
        slot: 'referenceVideo',
        filename: 'foreign.mp4',
        mimeType: 'video/mp4',
        size: 1,
        storageKey: 'foreign-video-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
      {
        id: 'audio-as-video',
        taskId: 'owned',
        userId: 'user-1',
        slot: 'audio',
        filename: 'audio.mp3',
        mimeType: 'audio/mpeg',
        size: 1,
        storageKey: 'audio-key',
        durationSeconds: null,
        createdAt: new Date(),
      },
    )
    const outcomes: unknown[] = []
    vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
      for (const assetId of ['foreign-video', 'audio-as-video']) {
        outcomes.push(await options?.executeTool?.({ name: 'analyze_reference_video', assetIds: [], assetId }))
      }
      return confirmationReply
    })

    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '分析这些视频',
          attachmentIds: ['audio-as-video'],
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(outcomes).toEqual([
      { status: 'unavailable', reason: 'asset_not_attached' },
      { status: 'unavailable', reason: 'asset_unavailable' },
    ])
    expect(harness.repository.videoAnalyses).toHaveLength(0)
    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
  })

  it('reuses succeeded video analysis and returns a structured pending result without creating duplicates', async () => {
    const video: PlayableAsset = {
      id: 'video-cache',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceVideo',
      filename: 'reference.mp4',
      mimeType: 'video/mp4',
      size: 1,
      storageKey: 'video-cache-key',
      durationSeconds: null,
      createdAt: new Date(),
    }
    harness.repository.assets.push(video)
    const invokeTool = async () => {
      let result: unknown
      vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (_input, options) => {
        result = await options?.executeTool?.({
          name: 'analyze_reference_video',
          assetIds: [],
          assetId: 'video-cache',
        })
        return confirmationReply
      })
      await (
        await harness.handlers.message(
          request('/api/playable-tasks/owned/messages', 'POST', {
            message: '分析视频',
            attachmentIds: ['video-cache'],
          }),
          {
            params: Promise.resolve({ taskId: 'owned' }),
          },
        )
      ).text()
      return result
    }
    harness.repository.videoAnalyses.push({
      id: 'cached',
      taskId: 'owned',
      assetId: video.id,
      status: 'succeeded',
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model: 'model',
      attempt: 1,
      mediaResolution: null,
      intentText: null,
      blueprint: gameplayBlueprint,
      keyframeStatus: null,
      keyframeImages: null,
      errorCode: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })

    await expect(invokeTool()).resolves.toEqual({ status: 'succeeded', blueprint: gameplayBlueprint })
    expect(harness.repository.videoAnalyses).toHaveLength(1)

    harness.repository.videoAnalyses[0] = {
      ...harness.repository.videoAnalyses[0],
      status: 'analyzing',
      blueprint: null,
      completedAt: null,
    }
    await expect(invokeTool()).resolves.toEqual({ status: 'unavailable', reason: 'analysis_pending' })
    expect(harness.repository.videoAnalyses).toHaveLength(1)
    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
  })

  it('does not invoke reference analysts when the agent does not request a tool', async () => {
    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '直接给我方案' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()

    expect(harness.imageAnalyst.analyze).not.toHaveBeenCalled()
    expect(harness.videoAnalyst.analyze).not.toHaveBeenCalled()
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

  it('renames an owned conversation through the task API', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    const response = await harness.handlers.rename(
      request('/api/playable-tasks/owned', 'PATCH', { title: '夏日海岛试玩' }),
      context,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ task: { id: 'owned', title: '夏日海岛试玩' } })
    const list = await harness.handlers.list(request('/api/playable-tasks'))
    expect(await list.json()).toEqual({
      tasks: [expect.objectContaining({ id: 'owned', title: '夏日海岛试玩' })],
    })
  })

  it('rejects blank and oversized conversation titles', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const responses = await Promise.all([
      harness.handlers.rename(request('/api/playable-tasks/owned', 'PATCH', { title: '   ' }), context),
      harness.handlers.rename(request('/api/playable-tasks/owned', 'PATCH', { title: 'x'.repeat(121) }), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([400, 400])
    const list = await harness.handlers.list(request('/api/playable-tasks'))
    expect(await list.json()).toEqual({ tasks: [expect.objectContaining({ id: 'owned', title: null })] })
  })

  it('deletes an owned conversation from subsequent task lists', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }

    const response = await harness.handlers.remove(request('/api/playable-tasks/owned', 'DELETE'), context)

    expect(response.status).toBe(204)
    const list = await harness.handlers.list(request('/api/playable-tasks'))
    expect(await list.json()).toEqual({ tasks: [] })
  })

  it('returns the same 404 for missing and cross-user resources', async () => {
    const missing = { params: Promise.resolve({ taskId: 'missing' }) }
    const foreign = { params: Promise.resolve({ taskId: 'foreign' }) }
    const calls = [
      () => harness.handlers.events(request('/api/playable-tasks/missing/events'), missing),
      () => harness.handlers.events(request('/api/playable-tasks/foreign/events'), foreign),
      () => harness.handlers.artifact(request('/api/playable-tasks/missing/artifact?kind=playable'), missing),
      () => harness.handlers.artifact(request('/api/playable-tasks/foreign/artifact?kind=playable'), foreign),
      () => harness.handlers.rename(request('/api/playable-tasks/foreign', 'PATCH', { title: 'Renamed' }), foreign),
      () => harness.handlers.remove(request('/api/playable-tasks/foreign', 'DELETE'), foreign),
      () =>
        harness.handlers.message(
          request('/api/playable-tasks/foreign/messages', 'POST', { message: 'steal' }),
          foreign,
        ),
      () => harness.handlers.confirm(request('/api/playable-tasks/foreign/confirm', 'POST', { confirmation }), foreign),
    ]
    const responses = await Promise.all(calls.map((call) => call()))

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404])
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

  it('validates current-message attachment IDs and forwards them to the requirement agent', async () => {
    harness.repository.assets.push({
      id: 'current-image',
      taskId: 'owned',
      userId: 'user-1',
      slot: 'referenceImage',
      filename: 'current.png',
      mimeType: 'image/png',
      size: 3,
      storageKey: 'private-current-image',
      durationSeconds: null,
      createdAt: new Date(0),
    })

    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', {
        message: '只分析本轮图片',
        attachmentIds: ['current-image'],
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    await response.text()

    expect(harness.agent.proposeConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ attachedAssetIds: ['current-image'] }),
      expect.any(Object),
    )
  })

  it.each([
    { attachmentIds: 'current-image' },
    { attachmentIds: [1] },
    { attachmentIds: Array.from({ length: 11 }, (_, index) => `asset-${index}`) },
    { attachmentIds: ['missing-asset'] },
  ])('rejects invalid or non-owned current-message attachment IDs', async ({ attachmentIds }) => {
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '分析附件', attachmentIds }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request' })
    expect(harness.agent.proposeConfirmation).not.toHaveBeenCalled()
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
    const stored = (await harness.repository.listMessages('owned')).findLast((item) => item.role === 'agent')
    expect(JSON.parse(stored!.content).reasoning).toContain('正在匹配可用玩法')
    expect(JSON.parse(stored!.content).reasoning).toContain(confirmationReply.reasoning)
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

  it('proposes and confirms a lightweight v2 patch that receives the current successful HTML', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.confirmation = confirmation
    task.latestArtifactKey = 'users/user-1/tasks/owned/build-1/playable.html'
    harness.repository.builds.push({
      id: 'build-1',
      taskId: 'owned',
      status: 'succeeded',
      confirmation,
      artifactKey: task.latestArtifactKey,
      createdAt: new Date(1),
      completedAt: new Date(2),
    })
    harness.artifacts.set(task.latestArtifactKey, new TextEncoder().encode('<html>version one</html>'))
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      kind: 'revision',
      message: '我会移除顶部标题，其他内容保持不变。',
      reasoning: '这是一个明确的局部修改。',
      revision: patchRevision,
      confirmation,
    })

    const messageResponse = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '去掉顶部 0/4 标题' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    const messageBody = await messageResponse.text()

    expect(messageBody).toContain('"type":"revision"')
    expect(task.phase).toBe('awaiting_revision_confirmation')
    expect(task.pendingRevision).toMatchObject({
      baseBuildId: 'build-1',
      baseVersion: 1,
      targetVersion: 2,
      strategy: 'patch',
    })

    const editedConfirmation = {
      ...confirmation,
      copy: { ...confirmation.copy, title: '用户确认后的 v2 标题' },
    }
    const confirmResponse = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        revisionId: task.pendingRevision?.id,
        confirmation: editedConfirmation,
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(confirmResponse.status).toBe(202)
    await harness.scheduled.at(-1)!()

    expect(harness.agent.build).toHaveBeenLastCalledWith(
      expect.objectContaining({
        confirmation: editedConfirmation,
        revision: expect.objectContaining({ strategy: 'patch', baseBuildId: 'build-1' }),
        baseHtml: '<html>version one</html>',
      }),
    )
    expect(task.phase).toBe('ready')
    expect(task.pendingRevision).toBeNull()
    expect(harness.repository.builds.filter((build) => build.status === 'succeeded')).toHaveLength(2)
  })

  it.each([null, 5])(
    'locks a manually selected v2 regardless of the model base %s or regeneration strategy',
    async (modelVersion) => {
      const task = harness.repository.tasks.get('owned')!
      task.phase = 'ready'
      task.confirmation = confirmation
      const historical = { ...confirmation, copy: { ...confirmation.copy, title: 'Original v2' } }
      for (let version = 1; version <= 5; version++) {
        const artifactKey = `manual/build-${version}/playable.html`
        harness.repository.builds.push({
          id: `build-${version}`,
          taskId: 'owned',
          status: 'succeeded',
          confirmation: version === 2 ? historical : confirmation,
          artifactKey,
          createdAt: new Date(version),
          completedAt: new Date(version),
        })
        harness.artifacts.set(artifactKey, new TextEncoder().encode(`<html>version ${version}</html>`))
        task.latestArtifactKey = artifactKey
      }
      vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (input) => {
        expect(input.lockedRevisionBase).toMatchObject({
          buildId: 'build-2',
          version: 2,
          html: '<html>version 2</html>',
        })
        expect(input.confirmation).toEqual(historical)
        return {
          kind: 'revision',
          message: '修改',
          reasoning: '修改',
          confirmation: historical,
          revision: { ...patchRevision, requestedBaseVersion: modelVersion, strategy: 'regenerate' },
        }
      })
      const response = await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '基于 v5 修改',
          baseBuildId: 'build-2',
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(await response.text()).toContain('"type":"revision"')
      expect(task.pendingRevision).toMatchObject({
        baseSelection: 'manual',
        baseBuildId: 'build-2',
        baseVersion: 2,
        targetVersion: 6,
        strategy: 'patch',
      })
      const confirmed = await harness.handlers.confirm(
        request('/api/playable-tasks/owned/confirm', 'POST', {
          revisionId: task.pendingRevision!.id,
          confirmation: historical,
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(confirmed.status).toBe(202)
      await harness.scheduled.at(-1)!()
      expect(harness.agent.build).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseHtml: '<html>version 2</html>',
          baseConfirmation: historical,
          revision: expect.objectContaining({ baseBuildId: 'build-2', strategy: 'patch' }),
        }),
      )
    },
  )

  it.each(['missing', 'foreign', 'failed', 'artifact-missing'])(
    'rejects an unusable manual base before calling the model: %s',
    async (kind) => {
      const task = harness.repository.tasks.get('owned')!
      task.phase = 'ready'
      task.latestArtifactKey = 'latest/playable.html'
      if (kind !== 'missing')
        harness.repository.builds.push({
          id: 'selected',
          taskId: kind === 'foreign' ? 'other' : 'owned',
          status: kind === 'failed' ? 'failed' : 'succeeded',
          confirmation,
          artifactKey: 'missing/playable.html',
          createdAt: new Date(1),
        })
      const response = await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', {
          message: '修改',
          baseBuildId: 'selected',
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(response.status).toBe(409)
      expect(harness.agent.proposeConfirmation).not.toHaveBeenCalled()
      expect(task.phase).toBe('ready')
    },
  )

  it.each([false, true])(
    'uses requested v2 and never falls back to v5 when its artifact disappears: %s',
    async (removeBase) => {
      const task = harness.repository.tasks.get('owned')!
      task.phase = 'ready'
      task.confirmation = confirmation
      for (let version = 1; version <= 5; version++) {
        const artifactKey = `users/user-1/tasks/owned/build-${version}/playable.html`
        harness.repository.builds.push({
          id: `build-${version}`,
          taskId: 'owned',
          status: 'succeeded',
          confirmation,
          artifactKey,
          createdAt: new Date(version),
          completedAt: new Date(version),
        })
        harness.artifacts.set(artifactKey, new TextEncoder().encode(`<html>version ${version}</html>`))
        task.latestArtifactKey = artifactKey
      }
      vi.mocked(harness.agent.proposeConfirmation).mockImplementationOnce(async (input, options) => {
        expect(input.versions).toEqual(
          expect.arrayContaining([expect.objectContaining({ version: 2, buildId: 'build-2', isLatest: false })]),
        )
        const result = await options!.executeTool!({
          name: 'read_playable_version',
          version: 2,
          assetIds: [],
          assetId: null,
        })
        expect(result).toMatchObject({ status: 'completed', version: 2, html: '<html>version 2</html>', confirmation })
        const missing = await options!.executeTool!({
          name: 'read_playable_version',
          version: 99,
          assetIds: [],
          assetId: null,
        })
        expect(missing).toMatchObject({ status: 'unavailable' })
        return {
          kind: 'revision',
          message: '基于 v2 修改',
          reasoning: '只修改多余行',
          revision: { ...patchRevision, requestedBaseVersion: 2 },
          confirmation,
        }
      })
      const response = await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '基于 v2 修改' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(await response.text()).toContain('"type":"revision"')
      expect(task.pendingRevision).toMatchObject({ baseBuildId: 'build-2', baseVersion: 2, targetVersion: 6 })
      const confirmed = await harness.handlers.confirm(
        request('/api/playable-tasks/owned/confirm', 'POST', {
          revisionId: task.pendingRevision!.id,
          confirmation,
        }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(confirmed.status).toBe(202)
      if (removeBase) harness.artifacts.delete('users/user-1/tasks/owned/build-2/playable.html')
      await harness.scheduled.at(-1)!()
      if (removeBase) {
        expect(harness.agent.build).not.toHaveBeenCalled()
        expect(task.phase).toBe('failed')
        expect(task.latestArtifactKey).toBe('users/user-1/tasks/owned/build-5/playable.html')
        return
      }
      expect(harness.agent.build).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseHtml: '<html>version 2</html>',
          baseConfirmation: confirmation,
          revision: expect.objectContaining({ baseBuildId: 'build-2', baseVersion: 2 }),
        }),
      )
    },
  )

  it('rejects an unavailable requested base version without using the latest build', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.confirmation = confirmation
    task.latestArtifactKey = 'latest/playable.html'
    harness.repository.builds.push({
      id: 'build-1',
      taskId: 'owned',
      status: 'succeeded',
      confirmation,
      artifactKey: task.latestArtifactKey,
      createdAt: new Date(1),
      completedAt: new Date(2),
    })
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      kind: 'revision',
      message: '修改',
      reasoning: '修改',
      revision: { ...patchRevision, requestedBaseVersion: 99 },
      confirmation,
    })
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: '基于 v99 修改' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(await response.text()).not.toContain('"type":"revision"')
    expect(task.phase).toBe('ready')
    expect(harness.agent.build).not.toHaveBeenCalled()
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
      durationSeconds: null,
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
        assets: [
          {
            id: 'asset-1',
            slot: 'audio',
            filename: 'farm.mp3',
            mimeType: 'audio/mpeg',
            size: 3,
            durationSeconds: null,
          },
        ],
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

  it('returns 503 from message and confirmation when the shared AI key is unavailable', async () => {
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

    expect(messageResponse.status).toBe(503)
    expect(confirmResponse.status).toBe(503)
    await expect(messageResponse.json()).resolves.toEqual({ error: 'AI service unavailable' })
    await expect(confirmResponse.json()).resolves.toEqual({ error: 'AI service unavailable' })
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
      durationSeconds: null,
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
      task: {
        phase: 'building',
        previewVersion: null,
        hasArtifact: false,
        artifactVersion: null,
        latestValidation: null,
        requirementBrief: null,
        confirmation,
        pendingRevision: null,
      },
      events: [],
    })
  })

  it('recovers a build whose worker stopped without recording a terminal state', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    task.updatedAt = new Date(Date.now() - 10 * 60 * 1000)
    harness.repository.builds.push({
      id: 'stale-build',
      taskId: task.id,
      status: 'building',
      confirmation,
      artifactKey: null,
      createdAt: task.updatedAt,
    })

    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const body = await response.json()

    expect(body.task.phase).toBe('failed')
    expect(body.events.at(-1)).toMatchObject({
      type: 'build_failed',
      phase: 'failed',
      message: '构建进程已停止，请重新确认方案并重试。',
    })
    expect(harness.repository.builds.at(-1)?.status).toBe('failed')
  })

  it('keeps a recently heartbeating build active', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    task.updatedAt = new Date()
    harness.repository.builds.push({
      id: 'active-build',
      taskId: task.id,
      status: 'building',
      confirmation,
      artifactKey: null,
      createdAt: task.updatedAt,
    })

    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const body = await response.json()

    expect(body.task.phase).toBe('building')
    expect(body.events).toEqual([])
    expect(harness.repository.builds.at(-1)?.status).toBe('building')
  })

  it('ignores a recovered worker after a newer build has started', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    harness.repository.builds.push(
      {
        id: 'expired-build',
        taskId: task.id,
        status: 'failed',
        confirmation,
        artifactKey: null,
        createdAt: new Date(0),
        completedAt: new Date(1),
      },
      {
        id: 'retry-build',
        taskId: task.id,
        status: 'building',
        confirmation,
        artifactKey: null,
        createdAt: new Date(2),
      },
    )

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'expired-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('building')
    expect(harness.repository.builds.map(({ status }) => status)).toEqual(['failed', 'building'])
    expect(harness.repository.events).toEqual([])
  })

  it('uses the stored validation delivery profile instead of a newer confirmation profile', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.confirmation = {
      ...confirmation,
      delivery: {
        profileId: 'generic_single_html',
        network: 'generic',
        logicalWidth: 360,
        logicalHeight: 640,
        output: 'single-html',
        maxBytes: null,
      },
    }
    task.latestValidation = createValidationReport({
      bytes: 5242881,
      offlineResources: true,
      responsiveViewport: true,
      delivery: confirmation.delivery,
    })

    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })

    expect((await response.json()).task.latestValidation).toMatchObject({
      deliveryCompliant: false,
      delivery: { profileId: 'applovin', maxBytes: 5242880 },
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

  it('persists fixed build activities before the terminal failure event', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockImplementationOnce(async (input) => {
      input.onActivity?.('command_started', { tool: 'bash', input: 'echo sk-test-secret', output: '检查完成' })
      input.onActivity?.('command_failed')
      throw new Error('private diagnostic')
    })
    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'activity-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })
    const events = await harness.repository.listEvents(task.id)
    expect(events.map((event) => event.type)).toEqual([
      'build_activity_stage_started',
      'build_activity_command_started',
      'build_activity_command_failed',
      'build_activity_stage_completed',
      'build_failed',
    ])
    expect(JSON.stringify(events)).not.toContain('private diagnostic')
    expect(JSON.stringify(events)).not.toContain('sk-test-secret')
    expect(JSON.parse(events.find((event) => event.type === 'build_activity_command_started')!.message!)).toMatchObject(
      {
        version: 1,
        detail: { input: 'echo [已隐藏]', output: '检查完成' },
      },
    )
    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    expect((await response.json()).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'build_activity_command_failed', message: '命令执行失败，等待 Agent 处理' }),
      ]),
    )
  })

  it.each(sourceTemplateIds.flatMap((id) => [null, 'zeus_scatter' as const].map((initial) => [id, initial] as const)))(
    'persists and builds %s instead of the initial template %s',
    async (sourceTemplateId, initial) => {
      const task = harness.repository.tasks.get('owned')!
      task.phase = 'awaiting_confirmation'
      task.prompt = templatePrompts[initial ?? 'center_collision']
      task.requirementBrief = { ...createRequirementBrief(), sourceTemplateId: initial }
      task.confirmation = { ...confirmation, sourceTemplateId: initial }
      const selected = { ...confirmation, sourceTemplateId }
      const response = await harness.handlers.confirm(
        request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: selected }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
      expect(response.status).toBe(202)
      expect(task.confirmation).toEqual(selected)
      expect(harness.repository.builds.at(-1)?.confirmation).toEqual(selected)
      await harness.scheduled.at(-1)!()
      expect(harness.agent.build).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmation: selected,
          baseHtml: await readFile(sourceTemplateFile(sourceTemplateId), 'utf8'),
        }),
      )
      expect(createProductionConfig(selected).core.sourceTemplateId).toBe(sourceTemplateId)
      const state = await (
        await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
          params: Promise.resolve({ taskId: 'owned' }),
        })
      ).json()
      expect(state.task.confirmation.sourceTemplateId).toBe(sourceTemplateId)
    },
  )

  it('keeps an explicit Mahjong selection after build, reload, and another requirement turn', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'awaiting_confirmation'
    task.prompt = templatePrompts.zeus_scatter
    task.requirementBrief = { ...createRequirementBrief(), sourceTemplateId: 'zeus_scatter' }
    task.confirmation = { ...confirmation, sourceTemplateId: 'zeus_scatter' }
    const selected = { ...confirmation, mode: 'gravity_fill' as const, sourceTemplateId: null }
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation: selected }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(response.status).toBe(202)
    await harness.scheduled.at(-1)!()
    expect(harness.agent.build).toHaveBeenCalledWith(expect.objectContaining({ confirmation: selected }))
    const state = await (
      await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
        params: Promise.resolve({ taskId: 'owned' }),
      })
    ).json()
    expect(state.task.confirmation).toMatchObject({ mode: 'gravity_fill', sourceTemplateId: null })
    expect(vi.mocked(harness.agent.build).mock.calls.at(-1)![0].baseHtml).toBeUndefined()
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      ...confirmationReply,
      confirmation: { ...confirmation, mode: 'gravity_fill' },
    })
    task.phase = 'failed'
    await (
      await harness.handlers.message(
        request('/api/playable-tasks/owned/messages', 'POST', { message: '继续调整玩法' }),
        { params: Promise.resolve({ taskId: 'owned' }) },
      )
    ).text()
    expect(task.requirementBrief?.sourceTemplateId).toBeNull()
    expect(task.confirmation).toMatchObject({ mode: 'gravity_fill', sourceTemplateId: null })
  })

  it('regenerates from the newly selected template when a patch changes templates', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'awaiting_revision_confirmation'
    task.confirmation = confirmation
    task.pendingRevision = {
      ...patchRevision,
      id: 'revision-1',
      baseBuildId: 'build-1',
      baseVersion: 1,
      targetVersion: 2,
    }
    harness.repository.builds.push({
      id: 'build-1',
      taskId: 'owned',
      status: 'succeeded',
      confirmation,
      artifactKey: 'old-html',
      createdAt: new Date(),
    })
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        revisionId: 'revision-1',
        confirmation: { ...confirmation, sourceTemplateId: 'balloon_master' },
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )
    expect(response.status).toBe(202)
    expect(harness.repository.builds.at(-1)?.revision?.strategy).toBe('regenerate')
    await harness.scheduled.at(-1)!()
    expect(harness.agent.build).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: expect.objectContaining({ strategy: 'regenerate' }),
        baseHtml: await readFile(sourceTemplateFile('balloon_master'), 'utf8'),
      }),
    )
  })

  it.each(['structured', 'legacy'])('loads selected source HTML for %s template tasks', async (selection) => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    if (selection === 'structured')
      task.requirementBrief = { ...createRequirementBrief(), sourceTemplateId: 'zeus_scatter' }
    else task.prompt = templatePrompts.zeus_scatter.replace('基于已选模板修改，', '使用 freeform 路线，')
    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'template-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })
    expect(harness.agent.build).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation: expect.objectContaining({
          sourceTemplateId: 'zeus_scatter',
          routing: confirmation.routing,
        }),
        baseHtml: await readFile(sourceTemplateFile('zeus_scatter'), 'utf8'),
      }),
    )
  })

  it('publishes an AppLovin artifact that only fails delivery size compliance', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({
        bytes: 5242881,
        offlineResources: true,
        responsiveViewport: true,
        delivery: confirmation.delivery,
      }),
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'oversized-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('ready')
    expect(task.latestValidation).toMatchObject({
      buildPassed: true,
      deliveryCompliant: false,
      gates: { packageSize: 'failed' },
    })
    expect(harness.repository.builds.at(-1)).toMatchObject({ id: 'oversized-build', status: 'succeeded' })
  })

  it('still rejects an artifact that fails a hard validation gate', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({
        bytes: 1024,
        offlineResources: false,
        responsiveViewport: true,
        delivery: confirmation.delivery,
      }),
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'unsafe-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(task.latestArtifactKey).toBeNull()
  })

  it('rejects an inconsistent report when any hard gate is marked failed', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    const validation = createValidationReport({
      bytes: 1024,
      offlineResources: false,
      responsiveViewport: true,
      delivery: confirmation.delivery,
    })
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: { ...validation, passed: true, buildPassed: true },
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'inconsistent-validation-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(task.latestArtifactKey).toBeNull()
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
      durationSeconds: null,
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
      durationSeconds: null,
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

  it('reports exhausted OpenAI credits as an actionable safe build error', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockRejectedValueOnce(
      new Error(
        'stream disconnected before completion: You have no credits remaining. Add credits at https://platform.openai.com/settings/organization/billing/',
      ),
    )

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'quota-failure-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(harness.repository.events.at(-1)).toMatchObject({
      type: 'build_failed',
      phase: 'failed',
      message: 'AI 服务额度暂时不可用，请联系管理员后重试。',
    })
    expect(JSON.stringify(harness.repository.events)).not.toContain('platform.openai.com')
  })

  it('reports an exhausted Codex overload retry as a specific safe build error', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockRejectedValueOnce(
      new PlayableBuildExecutionError(
        'agent',
        'Reconnecting... 1/5 (stream disconnected before completion: Our servers are currently overloaded. Please try again later.)',
      ),
    )

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'overload-failure-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(harness.repository.events.at(-1)).toMatchObject({
      type: 'build_failed',
      phase: 'failed',
      message: 'Codex 服务当前繁忙，自动重试后仍未完成，请稍后再试。',
    })
    expect(JSON.stringify(harness.repository.events)).not.toContain('Reconnecting')
    expect(JSON.stringify(harness.repository.events)).not.toContain('servers are currently overloaded')
  })

  it.each([
    {
      name: 'authentication failure',
      failure: new PlayableBuildExecutionError(
        'agent',
        Object.assign(new Error('private authentication details'), { statusCode: 401 }),
      ),
      message: 'Codex API Key 无效，或当前账号没有所选模型的访问权限，请检查配置后重试。',
    },
    {
      name: 'rate limit',
      failure: new PlayableBuildExecutionError(
        'agent',
        Object.assign(new Error('private rate-limit details'), { statusCode: 429 }),
      ),
      message: 'Codex 请求频率已达到限制，请稍后再试。',
    },
    {
      name: 'connection interruption',
      failure: new PlayableBuildExecutionError('agent', new Error('stream disconnected before completion')),
      message: 'Codex 连接中断，自动重试后仍未完成，请稍后再试。',
    },
  ])('reports a specific safe Codex error for $name', async ({ failure, message }) => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockRejectedValueOnce(failure)

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'classified-codex-failure-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(harness.repository.events.at(-1)).toMatchObject({ type: 'build_failed', phase: 'failed', message })
    expect(JSON.stringify(harness.repository.events)).not.toContain('private')
  })

  it('reports a Vercel Sandbox payment limit with a specific static diagnostic', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(harness.agent.build).mockRejectedValueOnce(
      new PlayableBuildExecutionError(
        'sandbox_create',
        Object.assign(new Error('private provider response'), { response: { status: 402 } }),
      ),
    )

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'sandbox-payment-failure-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(errorSpy).toHaveBeenCalledWith('Playable build failed while creating Vercel Sandbox: payment required')
    expect(harness.repository.events.at(-1)).toMatchObject({
      type: 'build_failed',
      phase: 'failed',
      message: 'Vercel Sandbox 额度不足，请升级套餐或等待额度重置后重试。',
    })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private provider response')
  })

  it('reports the safe stage when playable validation fails', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockRejectedValueOnce(
      new PlayableBuildExecutionError('validation', new Error('private validation details')),
    )

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'validation-failure-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(harness.repository.events.at(-1)).toMatchObject({
      type: 'build_failed',
      phase: 'failed',
      message: '试玩行为校验失败，请调整修改要求后重试。',
    })
    expect(JSON.stringify(harness.repository.events)).not.toContain('private validation details')
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
      "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; sandbox allow-scripts; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
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
        validation: createValidationReport({
          bytes: 5242881,
          offlineResources: true,
          responsiveViewport: true,
          delivery: confirmation.delivery,
        }),
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
        expect.objectContaining({
          id: 'build-2',
          status: 'succeeded',
          version: 2,
          current: true,
          validation: expect.objectContaining({ bytes: 5242881, deliveryCompliant: false }),
        }),
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

  it('returns owned library metadata through one bulk build lookup', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.title = 'Owned playable'
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
        validation: createValidationReport({
          bytes: 1024,
          offlineResources: true,
          responsiveViewport: true,
          delivery: confirmation.delivery,
        }),
        createdAt: new Date(5),
        completedAt: new Date(6),
      },
      {
        id: 'foreign-build',
        taskId: 'foreign',
        status: 'succeeded',
        confirmation,
        artifactKey: 'users/user-2/tasks/foreign/build/playable.html',
        createdAt: new Date(7),
        completedAt: new Date(8),
      },
    )
    const listBuildsForTasks = vi.spyOn(harness.repository, 'listBuildsForTasks')

    const response = await harness.handlers.library(request('/api/playable-tasks/library'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(listBuildsForTasks).toHaveBeenCalledWith(['owned'])
    expect(body.tasks).toEqual([expect.objectContaining({ id: 'owned', title: 'Owned playable', hasArtifact: true })])
    expect(body.versions).toEqual([
      expect.objectContaining({
        id: 'build-2',
        taskId: 'owned',
        version: 2,
        current: true,
        confirmation,
        delivery: expect.objectContaining({ label: 'AppLovin', logicalWidth: 360, logicalHeight: 640 }),
        validation: expect.objectContaining({ bytes: 1024, deliveryCompliant: true }),
      }),
      expect.objectContaining({ id: 'build-1', taskId: 'owned', version: 1, current: false }),
    ])
    expect(JSON.stringify(body)).not.toContain('failed-build')
    expect(JSON.stringify(body)).not.toContain('foreign')
    expect(JSON.stringify(body)).not.toContain('artifactKey')
    expect(JSON.stringify(body)).not.toContain('users/user-1')
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
      head: vi.fn(async () => null),
      issueClientToken: vi.fn(async () => 'client-token'),
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

  // The browser writes large videos itself, so the token is the only thing
  // stopping it from writing anywhere else or anything else.
  it('scopes a direct upload token to one private key, type, and size', async () => {
    const blobClient: PrivateBlobClient = {
      put: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      head: vi.fn(async () => ({ size: 9, contentType: 'video/mp4' })),
      issueClientToken: vi.fn(async () => 'client-token'),
    }
    const store = new PrivateVercelArtifactStore(blobClient)

    await expect(
      store.issueUploadToken('users/u/tasks/t/assets/a', { contentType: 'video/mp4', maxBytes: 100 }),
    ).resolves.toBe('client-token')
    expect(blobClient.issueClientToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: 'users/u/tasks/t/assets/a',
        allowedContentTypes: ['video/mp4'],
        maximumSizeInBytes: 100,
        addRandomSuffix: false,
        allowOverwrite: false,
      }),
    )
    await expect(store.describe('users/u/tasks/t/assets/a')).resolves.toEqual({ size: 9, contentType: 'video/mp4' })
  })
})

it('immediately saves a numbered preview and retains download and revision access after acceptance failure', async () => {
  const h = createHarness()
  const task = h.repository.tasks.get('owned')!
  task.phase = 'awaiting_confirmation'
  task.confirmation = confirmation
  await h.repository.claimBuild(task.id, task.userId, confirmation, 'preview-build')
  vi.mocked(h.agent.build).mockImplementationOnce(async (input) => {
    await input.onPreview!('<html>provisional</html>')
    expect(task.phase).toBe('building')
    expect(task.latestArtifactKey).toContain('/preview-build/preview.html')
    const ctx = { params: Promise.resolve({ taskId: 'owned' }) }
    const response = await h.handlers.events(request('/api/playable-tasks/owned/events'), ctx)
    expect((await response.json()).task).toMatchObject({ previewVersion: null, hasArtifact: true })
    const inline = await h.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable&preview=preview-build'),
      ctx,
    )
    expect(await inline.text()).toBe('<html>provisional</html>')
    expect(inline.headers.get('content-security-policy')).toContain("connect-src 'none'")
    for (const suffix of ['&download=1', '&version=preview-build']) {
      expect(
        (
          await h.handlers.artifact(
            request('/api/playable-tasks/owned/artifact?kind=playable&preview=preview-build' + suffix),
            ctx,
          )
        ).status,
      ).toBe(404)
    }
    expect(
      (
        await h.handlers.artifact(request('/api/playable-tasks/foreign/artifact?kind=playable&preview=preview-build'), {
          params: Promise.resolve({ taskId: 'foreign' }),
        })
      ).status,
    ).toBe(404)
    throw new Error('Acceptance failed')
  })
  await runConfirmedBuild({
    task,
    apiKey: 'sk-test-secret',
    buildId: 'preview-build',
    repository: h.repository,
    agent: h.agent,
    artifactStore: h.artifactStore,
  })
  expect(task.phase).toBe('failed')
  expect(task.latestArtifactKey).toContain('/preview-build/preview.html')
  expect([...h.artifacts.keys()].some((key) => key.endsWith('/preview.html'))).toBe(true)
  expect([...h.artifacts.keys()].some((key) => key.endsWith('/playable.html'))).toBe(false)
  const ctx = { params: Promise.resolve({ taskId: 'owned' }) }
  const versions = await h.handlers.versions(request('/api/playable-tasks/owned/versions'), ctx)
  expect((await versions.json()).builds).toEqual([
    expect.objectContaining({
      id: 'preview-build',
      version: 1,
      status: 'failed',
      validation: expect.objectContaining({ buildPassed: false }),
    }),
  ])
  const download = await h.handlers.artifact(
    request('/api/playable-tasks/owned/artifact?kind=playable&version=preview-build&download=1'),
    ctx,
  )
  expect(download.status).toBe(200)
  expect(download.headers.get('content-disposition')).toContain('attachment')
  expect(await download.text()).toBe('<html>provisional</html>')
  const report = await h.handlers.artifact(
    request('/api/playable-tasks/owned/artifact?kind=validation&version=preview-build&download=1'),
    ctx,
  )
  expect((await report.json()).buildPassed).toBe(false)
  vi.mocked(h.agent.proposeConfirmation).mockResolvedValueOnce({
    kind: 'revision',
    message: '修复',
    reasoning: '继续修改',
    revision: patchRevision,
    confirmation,
  })
  const message = await h.handlers.message(
    request('/api/playable-tasks/owned/messages', 'POST', { message: '继续修复', baseBuildId: 'preview-build' }),
    ctx,
  )
  expect(await message.text()).toContain('"type":"revision"')
  expect(task.pendingRevision).toMatchObject({ baseBuildId: 'preview-build', baseVersion: 1, targetVersion: 2 })
})

it('recovers a previously unregistered failed preview without another build', async () => {
  const h = createHarness()
  const task = h.repository.tasks.get('owned')!
  task.phase = 'failed'
  task.confirmation = confirmation
  h.repository.builds.push({
    id: 'legacy',
    taskId: 'owned',
    status: 'failed',
    confirmation,
    artifactKey: null,
    createdAt: new Date(1),
  })
  const key = 'users/user-1/tasks/owned/legacy/preview.html'
  h.artifacts.set(key, new TextEncoder().encode('<html>recoverable</html>'))
  await h.repository.appendEvent({
    taskId: 'owned',
    type: 'build_preview_ready',
    message: JSON.stringify({ buildId: 'legacy' }),
  })
  const ctx = { params: Promise.resolve({ taskId: 'owned' }) }
  const response = await h.handlers.versions(request('/api/playable-tasks/owned/versions'), ctx)
  expect((await response.json()).builds).toEqual([
    expect.objectContaining({
      id: 'legacy',
      version: 1,
      status: 'failed',
      current: true,
      validation: expect.objectContaining({ buildPassed: false }),
    }),
  ])
  expect(task.latestArtifactKey).toBe(key)
  const file = await h.handlers.artifact(
    request('/api/playable-tasks/owned/artifact?kind=playable&version=legacy&download=1'),
    ctx,
  )
  expect(await file.text()).toBe('<html>recoverable</html>')
  expect(h.agent.build).not.toHaveBeenCalled()
})

it('upgrades a saved preview to accepted output without creating a second version', async () => {
  const h = createHarness()
  const task = h.repository.tasks.get('owned')!
  task.phase = 'awaiting_confirmation'
  task.confirmation = confirmation
  await h.repository.claimBuild(task.id, task.userId, confirmation, 'one-build')
  vi.mocked(h.agent.build).mockImplementationOnce(async (input) => {
    await input.onPreview!('<html>preview</html>')
    return {
      html: '<html>accepted</html>',
      validation: createValidationReport({ bytes: 21, offlineResources: true, responsiveViewport: true }),
    }
  })
  await runConfirmedBuild({
    task,
    apiKey: 'sk-test-secret',
    buildId: 'one-build',
    repository: h.repository,
    agent: h.agent,
    artifactStore: h.artifactStore,
  })
  expect(task.phase).toBe('ready')
  const response = await h.handlers.versions(request('/api/playable-tasks/owned/versions'), {
    params: Promise.resolve({ taskId: 'owned' }),
  })
  expect((await response.json()).builds).toEqual([
    expect.objectContaining({
      id: 'one-build',
      version: 1,
      status: 'succeeded',
      validation: expect.objectContaining({ buildPassed: true }),
    }),
  ])
  expect(task.latestArtifactKey).toContain('/one-build/playable.html')
  expect(h.repository.builds).toHaveLength(1)
  const previewReport = h.artifacts.get('users/user-1/tasks/owned/one-build/preview-validation-report.json')!
  const fullReport = h.artifacts.get('users/user-1/tasks/owned/one-build/validation-report.json')!
  expect(JSON.parse(new TextDecoder().decode(previewReport)).buildPassed).toBe(false)
  expect(JSON.parse(new TextDecoder().decode(fullReport)).buildPassed).toBe(true)
})
