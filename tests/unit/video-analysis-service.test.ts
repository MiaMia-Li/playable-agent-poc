import { describe, expect, it, vi } from 'vitest'
import type { GameplayBlueprint } from '@/lib/playable/schemas'
import type { PlayableVideoAnalysisRecord, PlayableTaskRecord } from '@/lib/playable/task-api'
import type { PlayableAsset } from '@/lib/playable/task-assets'
import { runVideoAnalysis } from '@/lib/playable/video-analysis-service'
import { GeminiVideoAnalysisError } from '@/lib/playable/video-gameplay-analyst'

const blueprint: GameplayBlueprint = {
  version: 1,
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
  createdAt: new Date(),
}

const analysis: PlayableVideoAnalysisRecord = {
  id: 'analysis-1',
  taskId: task.id,
  assetId: asset.id,
  status: 'pending',
  pipelineVersion: 'v1',
  model: 'model',
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

function harness() {
  const repository = {
    updateVideoAnalysisStatus: vi.fn(async (_id: string, _status: PlayableVideoAnalysisRecord['status']) => undefined),
    appendEvent: vi.fn(async (_event: { taskId: string; type: string; message: string }) => undefined),
    completeVideoAnalysis: vi.fn(async (_id: string, _blueprint: GameplayBlueprint) => undefined),
    failVideoAnalysis: vi.fn(async (_id: string, _errorCode: string) => undefined),
  }
  const artifactStore = { get: vi.fn(async () => stream(new Uint8Array([1]))) }
  const analyst = { analyze: vi.fn(async () => blueprint) }
  return { repository, artifactStore, analyst }
}

describe('QDAI video analysis service', () => {
  it('sends private video bytes directly to the analyst and persists the structured blueprint', async () => {
    const dependencies = harness()

    const result = await runVideoAnalysis({
      task,
      asset,
      analysis,
      apiKey: 'sk-test-secret',
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
      expect.objectContaining({ video: { mimeType: 'video/mp4', bytes: new Uint8Array([1]) } }),
    )
    expect(dependencies.repository.completeVideoAnalysis).toHaveBeenCalledWith(analysis.id, blueprint)
    expect(dependencies.repository.failVideoAnalysis).not.toHaveBeenCalled()
  })

  it('passes the caller cancellation signal through preprocessing and analysis', async () => {
    const dependencies = harness()
    const controller = new AbortController()

    await runVideoAnalysis({
      task,
      asset,
      analysis,
      apiKey: 'sk-test-secret',
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
    dependencies.analyst.analyze.mockRejectedValueOnce(new GeminiVideoAnalysisError('video_too_large'))

    const result = await runVideoAnalysis({
      task,
      asset,
      analysis,
      apiKey: 'sk-test-secret',
      repository: dependencies.repository as never,
      artifactStore: dependencies.artifactStore as never,
      analyst: dependencies.analyst,
    })

    expect(result).toBeUndefined()
    expect(dependencies.repository.failVideoAnalysis).toHaveBeenCalledWith(analysis.id, 'video_too_large')
    expect(dependencies.repository.completeVideoAnalysis).not.toHaveBeenCalled()
  })
})
