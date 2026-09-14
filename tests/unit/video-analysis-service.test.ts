import { describe, expect, it, vi } from 'vitest'
import type { GameplayBlueprint } from '@/lib/playable/schemas'
import type { PlayableVideoAnalysisRecord, PlayableTaskRecord } from '@/lib/playable/task-api'
import type { PlayableAsset } from '@/lib/playable/task-assets'
import { runIntentComparison, runVideoAnalysis } from '@/lib/playable/video-analysis-service'
import type { AppliedMediaResolution } from '@/lib/playable/video-gameplay-analyst'

const blueprint: GameplayBlueprint = {
  version: 2,
  summary: '点击两个相同目标并消除。',
  orientation: 'portrait',
  controls: [{ value: '点击', confidence: 0.9, evidence: [] }],
  sceneStructure: { value: '网格', confidence: 0.9, evidence: [] },
  entities: [],
  coreLoop: { value: '配对并消除', confidence: 0.9, evidence: [] },
  stateTransitions: [{ value: '目标消失', confidence: 0.9, evidence: [] }],
  objective: { value: '清空目标', confidence: 0.8, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  audio: [],
  intentDivergence: [],
  visualStyle: '卡通',
  uncertainties: [],
  overallConfidence: 0.88,
}

const task: PlayableTaskRecord = {
  id: 'task-1',
  userId: 'user-1',
  prompt: '参考视频制作试玩',
  phase: 'draft',
  requirementBrief: null,
  confirmation: null,
  latestArtifactKey: null,
  activeReferenceVideoAssetId: 'asset-1',
  gameplayAnnotations: [],
}

const asset: PlayableAsset = {
  id: 'asset-1',
  taskId: task.id,
  userId: task.userId,
  slot: 'referenceVideo',
  filename: 'reference.mp4',
  mimeType: 'video/mp4',
  size: 1,
  storageKey: 'private-reference',
  durationSeconds: 12,
  createdAt: new Date(),
}

const analysis: PlayableVideoAnalysisRecord = {
  id: 'analysis-1',
  taskId: task.id,
  assetId: asset.id,
  status: 'pending',
  pipelineVersion: 'qdai-video-v2',
  model: 'model',
  attempt: 1,
  mediaResolution: null,
  intentText: null,
  blueprint: null,
  errorCode: null,
  createdAt: new Date(),
  completedAt: null,
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function harness(mediaResolution: AppliedMediaResolution = 'high') {
  const repository = {
    updateVideoAnalysisStatus: vi.fn(async (_id: string, _status: PlayableVideoAnalysisRecord['status']) => undefined),
    appendEvent: vi.fn(async (_event: { taskId: string; type: string; message: string }) => undefined),
    completeVideoAnalysis: vi.fn(
      async (_id: string, _blueprint: GameplayBlueprint, _mediaResolution: AppliedMediaResolution, _intent: string) =>
        undefined,
    ),
    failVideoAnalysis: vi.fn(async (_id: string, _errorCode: string) => undefined),
    recordIntentComparison: vi.fn(async (_input: unknown): Promise<unknown> => ({})),
  }
  const artifactStore = { get: vi.fn(async () => stream(new Uint8Array([1]))) }
  const analyst = {
    model: 'gemini-test',
    analyze: vi.fn(async () => ({ blueprint, mediaResolution })),
    compareIntent: vi.fn(async (): Promise<GameplayBlueprint['intentDivergence']> => []),
  }
  return { repository, artifactStore, analyst }
}

describe('QDAI video analysis service', () => {
  it('hands the raw video bytes to the analyst and persists the structured blueprint', async () => {
    const dependencies = harness()

    const result = await runVideoAnalysis({
      task,
      asset,
      analysis,
      repository: dependencies.repository as never,
      artifactStore: dependencies.artifactStore as never,
      analyst: dependencies.analyst,
    })

    expect(result).toEqual(blueprint)
    expect(dependencies.repository.updateVideoAnalysisStatus.mock.calls.map((call) => call[1])).toEqual([
      'preprocessing',
      'analyzing',
    ])
    expect(dependencies.analyst.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        video: { bytes: new Uint8Array([1]), mimeType: 'video/mp4', durationSeconds: 12 },
      }),
    )
    // The intent the divergence was computed against is kept with the result,
    // which is how a later change of intent is noticed.
    expect(dependencies.repository.completeVideoAnalysis).toHaveBeenCalledWith(
      analysis.id,
      blueprint,
      'high',
      '概述：参考视频制作试玩',
    )
    expect(dependencies.repository.failVideoAnalysis).not.toHaveBeenCalled()
  })

  // The applied resolution decides what the success event tells the user, so a
  // degraded run has to stay distinguishable from a clean one after the fact.
  it('records the resolution the analyst actually got and says so in the event', async () => {
    const dependencies = harness('default')

    await runVideoAnalysis({
      task,
      asset,
      analysis,
      repository: dependencies.repository as never,
      artifactStore: dependencies.artifactStore as never,
      analyst: dependencies.analyst,
    })

    expect(dependencies.repository.completeVideoAnalysis).toHaveBeenCalledWith(
      analysis.id,
      blueprint,
      'default',
      expect.any(String),
    )
    expect(dependencies.repository.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'video_gameplay_analysis_succeeded',
        message: 'Gameplay blueprint is ready, analysed at reduced resolution',
      }),
    )
  })

  it('passes the caller cancellation signal through to the analyst', async () => {
    const dependencies = harness()
    const controller = new AbortController()

    await runVideoAnalysis({
      task,
      asset,
      analysis,
      repository: dependencies.repository as never,
      artifactStore: dependencies.artifactStore as never,
      analyst: dependencies.analyst,
      abortSignal: controller.signal,
    })

    expect(dependencies.analyst.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal }),
    )
  })

  it('records a static failure code without leaking the underlying error', async () => {
    const dependencies = harness()
    dependencies.analyst.analyze.mockRejectedValueOnce(new Error('private path and details'))

    const result = await runVideoAnalysis({
      task,
      asset,
      analysis,
      repository: dependencies.repository as never,
      artifactStore: dependencies.artifactStore as never,
      analyst: dependencies.analyst,
    })

    expect(result).toBeUndefined()
    expect(dependencies.repository.failVideoAnalysis).toHaveBeenCalledWith(analysis.id, 'analysis_failed')
    expect(dependencies.repository.completeVideoAnalysis).not.toHaveBeenCalled()
  })
})

describe('intent divergence comparison', () => {
  const succeeded: PlayableVideoAnalysisRecord = {
    ...analysis,
    status: 'succeeded',
    blueprint,
    mediaResolution: 'default',
    intentText: '',
    completedAt: new Date(),
  }
  const divergence = [{ value: '视频是连连看，不是三消', confidence: 0.9, evidence: [] }]
  const compare = (dependencies: ReturnType<typeof harness>) =>
    runIntentComparison({
      id: 'analysis-2',
      task,
      asset,
      analysis: succeeded,
      intent: '玩法概念：三消',
      repository: dependencies.repository as never,
      analyst: dependencies.analyst,
    })

  // The model supplies the divergence and nothing else. Copying the rest here
  // is what guarantees the recorded observation was not quietly rewritten.
  it('records only the divergence, copying every other field of the observation', async () => {
    const dependencies = harness()
    dependencies.analyst.compareIntent.mockResolvedValueOnce(divergence)

    await expect(compare(dependencies)).resolves.toBe(true)

    expect(dependencies.analyst.compareIntent).toHaveBeenCalledWith(
      expect.objectContaining({ blueprint, intent: '玩法概念：三消', durationSeconds: 12 }),
    )
    expect(dependencies.repository.recordIntentComparison).toHaveBeenCalledWith({
      id: 'analysis-2',
      taskId: task.id,
      assetId: asset.id,
      pipelineVersion: 'qdai-video-v2',
      model: 'model',
      attempt: 2,
      blueprint: { ...blueprint, intentDivergence: divergence },
      mediaResolution: 'default',
      intentText: '玩法概念：三消',
    })
  })

  it('drops the result when a newer attempt has taken its place', async () => {
    const dependencies = harness()
    dependencies.repository.recordIntentComparison.mockResolvedValueOnce(undefined)

    await expect(compare(dependencies)).resolves.toBe(false)
    expect(dependencies.repository.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video_intent_divergence_updated' }),
    )
  })

  it('records nothing when the comparison fails', async () => {
    const dependencies = harness()
    dependencies.analyst.compareIntent.mockRejectedValueOnce(new Error('private details'))

    await expect(compare(dependencies)).resolves.toBe(false)
    expect(dependencies.repository.recordIntentComparison).not.toHaveBeenCalled()
  })
})
