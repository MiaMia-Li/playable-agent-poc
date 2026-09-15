import { describe, expect, it, vi } from 'vitest'
import {
  effectiveKeyframeStatus,
  keyframeFfmpegArgs,
  loadReferenceKeyframesForBuild,
  referenceKeyframeCutPlan,
  runReferenceKeyframeExtraction,
  type ReferenceKeyframeSnapshot,
  SandboxReferenceKeyframeExtractor,
  type ReferenceKeyframeExtractor,
} from '@/lib/playable/reference-keyframes'
import type { PlayableSandbox } from '@/lib/playable/sandbox-runner'
import type { GameplayBlueprint } from '@/lib/playable/schemas'
import type { PlayableTaskRecord, PlayableVideoAnalysisRecord } from '@/lib/playable/task-api'
import type { PlayableAsset } from '@/lib/playable/task-assets'

const blueprint: GameplayBlueprint = {
  version: 4,
  summary: '老虎机',
  orientation: 'portrait',
  timeline: [],
  controls: [],
  sceneStructure: { value: '网格', confidence: 0.9, evidence: [] },
  entities: [],
  coreLoop: { value: '旋转', confidence: 0.9, evidence: [] },
  stateTransitions: [],
  objective: { value: '中奖', confidence: 0.8, evidence: [] },
  failureConditions: [],
  progression: [],
  tutorial: [],
  endCard: null,
  visualSpec: {
    artStyle: '3D 卡通',
    palette: [],
    background: '',
    layout: [],
    uiComponents: [],
    entityLooks: [],
    effects: [],
  },
  keyframes: [
    { seconds: 1, focus: '主界面布局' },
    { seconds: 29, focus: 'EPIC WIN 结算页' },
  ],
  audio: [],
  intentDivergence: [],
  uncertainties: [],
  overallConfidence: 0.9,
}

const task: PlayableTaskRecord = {
  id: 'task-1',
  userId: 'user-1',
  prompt: '',
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
  durationSeconds: 32,
  createdAt: new Date(),
}

const analysis: PlayableVideoAnalysisRecord = {
  id: 'analysis-1',
  taskId: task.id,
  assetId: asset.id,
  status: 'succeeded',
  pipelineVersion: 'video-analysis-v4',
  model: 'model',
  attempt: 2,
  mediaResolution: 'high',
  intentText: '',
  blueprint,
  keyframeStatus: 'pending',
  keyframeImages: [],
  errorCode: null,
  createdAt: new Date(),
  completedAt: new Date(),
}

function harness(extractor?: ReferenceKeyframeExtractor) {
  const repository = {
    saveReferenceKeyframes: vi.fn(async (_input: unknown) => undefined),
    appendEvent: vi.fn(async (_event: { taskId: string; type: string; message: string }) => undefined),
  }
  const artifactStore = {
    get: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([9]))
            controller.close()
          },
        }),
    ),
    put: vi.fn(async (_key: string, _value: string | Uint8Array, _contentType: string) => undefined),
  }
  const run = (overrides: Partial<PlayableVideoAnalysisRecord> = {}) =>
    runReferenceKeyframeExtraction({
      task,
      asset,
      analysis: { ...analysis, ...overrides },
      repository: repository as never,
      artifactStore,
      extractor,
    })
  const statuses = () =>
    repository.saveReferenceKeyframes.mock.calls.map((call) => (call[0] as { status: string }).status)
  return { repository, artifactStore, run, statuses }
}

describe('reference keyframe extraction', () => {
  // The model's seconds ran about a second early on a real run, so each
  // keyframe is cut at its second and just after it (spec §13).
  it('cuts each keyframe at its second and just after, and records every frame that was cut', async () => {
    const one = new Uint8Array([1])
    const two = new Uint8Array([2])
    const extractor = { extract: vi.fn(async () => [null, null, null, one, null, two]) }
    const { repository, artifactStore, run, statuses } = harness(extractor)

    await expect(run()).resolves.toBe('succeeded')

    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'analysis-1',
        seconds: [1, 1.5, 2, 29, 29.5, 30],
        video: new Uint8Array([9]),
      }),
    )
    expect(artifactStore.put.mock.calls.map((call) => call[0])).toEqual([
      'users/user-1/tasks/task-1/analyses/analysis-1/keyframes/2-1.jpg',
      'users/user-1/tasks/task-1/analyses/analysis-1/keyframes/2-3.jpg',
    ])
    expect(statuses()).toEqual(['extracting', 'succeeded'])
    // Written against every attempt of this video that picked these keyframes.
    expect(repository.saveReferenceKeyframes).toHaveBeenLastCalledWith({
      assetId: 'asset-1',
      pipelineVersion: 'video-analysis-v4',
      model: 'model',
      fromAttempt: 2,
      keyframes: blueprint.keyframes,
      status: 'succeeded',
      images: [
        { keyframeIndex: 1, seconds: 29, storageKey: artifactStore.put.mock.calls[0][0], mimeType: 'image/jpeg' },
        { keyframeIndex: 1, seconds: 30, storageKey: artifactStore.put.mock.calls[1][0], mimeType: 'image/jpeg' },
      ],
    })
  })

  it('keeps cuts inside the video, collapsing those that land on the last frame', () => {
    expect(referenceKeyframeCutPlan([{ seconds: 31.5, focus: '结束卡' }], 32)).toEqual([
      { keyframeIndex: 0, cut: 0, seconds: 31.5 },
      { keyframeIndex: 0, cut: 1, seconds: 31.95 },
    ])
    expect(referenceKeyframeCutPlan([{ seconds: 3, focus: '开局' }], null).map((entry) => entry.seconds)).toEqual([
      3, 3.5, 4,
    ])
  })

  it('succeeds with nothing to cut when the model picked no keyframes', async () => {
    const extractor = { extract: vi.fn() }
    const { run, statuses } = harness(extractor)

    await expect(run({ blueprint: { ...blueprint, keyframes: [] } })).resolves.toBe('succeeded')
    expect(extractor.extract).not.toHaveBeenCalled()
    expect(statuses()).toEqual(['succeeded'])
  })

  it('reads as unavailable without an extractor or without ffmpeg, never as a failure', async () => {
    const withoutExtractor = harness()
    await expect(withoutExtractor.run()).resolves.toBe('unavailable')
    expect(withoutExtractor.statuses()).toEqual(['unavailable'])

    const withoutFfmpeg = harness({ extract: vi.fn(async () => 'unavailable' as const) })
    await expect(withoutFfmpeg.run()).resolves.toBe('unavailable')
    expect(withoutFfmpeg.statuses()).toEqual(['extracting', 'unavailable'])
  })

  it('records a failure instead of throwing when nothing could be cut or the extractor breaks', async () => {
    const nothingCut = harness({ extract: vi.fn(async () => [null, null]) })
    await expect(nothingCut.run()).resolves.toBe('failed')
    expect(nothingCut.statuses().at(-1)).toBe('failed')

    const broken = harness({
      extract: vi.fn(async () => {
        throw new Error('sandbox creation failed')
      }),
    })
    await expect(broken.run()).resolves.toBe('failed')
    expect(broken.statuses().at(-1)).toBe('failed')
  })

  it('logs static event messages only', async () => {
    const { repository, run } = harness({ extract: vi.fn(async () => [new Uint8Array([1]), null]) })
    await run()
    for (const [event] of repository.appendEvent.mock.calls) {
      expect(event.message).not.toMatch(/analysis-1|task-1|private-reference|\d+\.jpg/)
    }
  })
})

describe('sandbox keyframe extractor', () => {
  function fakeSandbox(options: { ffmpeg: boolean }) {
    const commands: string[] = []
    const sandbox: PlayableSandbox = {
      defaultWorkingDirectory: '/vercel/sandbox',
      writeBinaryFile: vi.fn(async () => undefined),
      writeTextFile: vi.fn(async () => undefined),
      readBinaryFile: vi.fn(async () => new Uint8Array([7])),
      readTextFile: vi.fn(async () => null),
      run: vi.fn(async ({ command }: { command: string }) => {
        commands.push(command)
        return {
          exitCode: command.startsWith('ffmpeg -hide_banner') && !options.ffmpeg ? 127 : 0,
          stdout: '',
          stderr: '',
        }
      }),
      destroy: vi.fn(async () => undefined),
    }
    return { sandbox, commands }
  }

  it('names the sandbox after the analysis, cuts each second, and always destroys it', async () => {
    const { sandbox, commands } = fakeSandbox({ ffmpeg: true })
    const createSandbox = vi.fn(async () => sandbox)
    const extractor = new SandboxReferenceKeyframeExtractor(createSandbox)

    const frames = await extractor.extract({ analysisId: 'analysis-1', video: new Uint8Array([1]), seconds: [1, 2.5] })

    expect(createSandbox).toHaveBeenCalledWith('keyframes-analysis-1', undefined)
    expect(frames).toEqual([new Uint8Array([7]), new Uint8Array([7])])
    expect(commands.filter((command) => command.includes("'-ss'"))).toHaveLength(2)
    expect(commands.some((command) => command.includes("'2.500'"))).toBe(true)
    expect(sandbox.destroy).toHaveBeenCalled()
  })

  // Never installed on the fly: an old snapshot only costs the keyframes (ADR 0003).
  it('reports unavailable when the snapshot has no ffmpeg, and installs nothing', async () => {
    const { sandbox, commands } = fakeSandbox({ ffmpeg: false })
    const extractor = new SandboxReferenceKeyframeExtractor(async () => sandbox)

    await expect(
      extractor.extract({ analysisId: 'analysis-1', video: new Uint8Array([1]), seconds: [1] }),
    ).resolves.toBe('unavailable')
    expect(commands).toEqual(['ffmpeg -hide_banner -version'])
    expect(sandbox.destroy).toHaveBeenCalled()
  })
})

describe('keyframe helpers', () => {
  it('builds ffmpeg arguments from numbers and paths only', () => {
    const args = keyframeFfmpegArgs('/work/video', 3, '/work/1.jpg')
    expect(args).toContain('3.000')
    expect(args.at(-1)).toBe('/work/1.jpg')
  })

  it('reads an extraction left running for too long as failed', () => {
    const completedAt = new Date('2026-09-15T00:00:00Z')
    const now = completedAt.getTime()
    expect(effectiveKeyframeStatus({ keyframeStatus: 'extracting', completedAt }, now + 60_000)).toBe('extracting')
    expect(effectiveKeyframeStatus({ keyframeStatus: 'extracting', completedAt }, now + 16 * 60_000)).toBe('failed')
    expect(effectiveKeyframeStatus({ keyframeStatus: 'succeeded', completedAt }, now + 16 * 60_000)).toBe('succeeded')
  })
})

describe('reference keyframes for a build', () => {
  const images = [{ keyframeIndex: 1, seconds: 29.5, storageKey: 'keyframe-2', mimeType: 'image/jpeg' as const }]
  const store = {
    get: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([5]))
            controller.close()
          },
        }),
    ),
  }
  const snapshot = (status: ReferenceKeyframeSnapshot['status']): ReferenceKeyframeSnapshot => ({
    status,
    keyframes: blueprint.keyframes,
    images: status === 'succeeded' ? images : [],
  })

  it('waits for keyframes still being cut, then loads each with what it is for', async () => {
    const read = vi
      .fn<() => Promise<ReferenceKeyframeSnapshot | undefined>>()
      .mockResolvedValueOnce(snapshot('extracting'))
      .mockResolvedValueOnce(snapshot('succeeded'))
    const sleep = vi.fn(async () => undefined)

    await expect(loadReferenceKeyframesForBuild({ read, artifactStore: store, sleep })).resolves.toEqual([
      {
        keyframeIndex: 1,
        labelledSeconds: 29,
        seconds: 29.5,
        focus: 'EPIC WIN 结算页',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([5]),
      },
    ])
    expect(sleep).toHaveBeenCalledOnce()
  })

  // Keyframes are extra evidence: the build goes ahead without them.
  it('gives up after the wait and builds without keyframes that failed or never arrived', async () => {
    const stillRunning = vi.fn(async () => snapshot('extracting'))
    await expect(
      loadReferenceKeyframesForBuild({ read: stillRunning, artifactStore: store, waitMs: 0, sleep: vi.fn() }),
    ).resolves.toEqual([])

    await expect(
      loadReferenceKeyframesForBuild({ read: async () => snapshot('failed'), artifactStore: store }),
    ).resolves.toEqual([])
    await expect(
      loadReferenceKeyframesForBuild({ read: async () => undefined, artifactStore: store }),
    ).resolves.toEqual([])
  })
})
