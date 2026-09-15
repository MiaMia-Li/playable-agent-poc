import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ArtifactStore } from './artifact-store'
import { createPlayableSandbox, type PlayableSandbox } from './sandbox-runner'
import type { ReferenceKeyframeBuildInput } from './reference-keyframes-build'
import type { ReferenceKeyframe, ReferenceKeyframeImage, ReferenceKeyframeStatus } from './schemas'
import type { PlayableTaskRecord, PlayableTaskRepository, PlayableVideoAnalysisRecord } from './task-api'
import type { PlayableAsset } from './task-assets'
import { readAll } from './video-analysis-service'

/**
 * Its own budget, scheduled after the analysis rather than inside it: the
 * analysis route's time is already spent by `VIDEO_ANALYSIS_BUDGET_MS`.
 */
export const REFERENCE_KEYFRAME_BUDGET_MS = 300_000

/**
 * Past this, a row still `pending` or `extracting` is read as failed. A
 * function the platform kills never records its own failure, which is the
 * same gap `STALE_ANALYSIS_MS` covers for the analysis itself.
 */
const STALE_KEYFRAMES_MS = 15 * 60 * 1000

/** What the build and the UI should treat a row's keyframe status as. */
export function effectiveKeyframeStatus(
  analysis: Pick<PlayableVideoAnalysisRecord, 'keyframeStatus' | 'completedAt'>,
  now = Date.now(),
): ReferenceKeyframeStatus | null {
  const status = analysis.keyframeStatus
  if (status !== 'pending' && status !== 'extracting') return status
  const since = analysis.completedAt?.getTime()
  return since !== undefined && now - since >= STALE_KEYFRAMES_MS ? 'failed' : status
}

export interface ReferenceKeyframeExtractor {
  /**
   * One entry per requested second, null where that frame could not be cut.
   * `unavailable` when there is no ffmpeg to cut with: never installed on the
   * fly, see ADR 0003.
   */
  extract(input: {
    analysisId: string
    video: Uint8Array
    seconds: number[]
    abortSignal?: AbortSignal
  }): Promise<(Uint8Array | null)[] | 'unavailable'>
}

const KEYFRAME_LONG_EDGE = 1280
const KEYFRAME_SCALE_FILTER = `scale=w='if(gt(iw,ih),min(${KEYFRAME_LONG_EDGE},iw),-2)':h='if(gt(iw,ih),-2,min(${KEYFRAME_LONG_EDGE},ih))'`

/**
 * Only numbers and server-built paths reach the command line, never model text.
 * `-ss` before `-i` seeks on the input, which is fast and exact enough for a
 * still frame.
 */
export function keyframeFfmpegArgs(input: string, seconds: number, output: string): string[] {
  return [
    '-v',
    'error',
    '-y',
    '-ss',
    seconds.toFixed(3),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    KEYFRAME_SCALE_FILTER,
    '-q:v',
    '3',
    output,
  ]
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Restored from the build snapshot, which carries ffmpeg once the snapshot is
 * rebuilt. Named after the analysis so it can never collide with the task's
 * build sandbox, which is named after the task.
 */
export class SandboxReferenceKeyframeExtractor implements ReferenceKeyframeExtractor {
  constructor(
    private readonly createSandbox: (
      sessionId: string,
      abortSignal?: AbortSignal,
    ) => PromiseLike<PlayableSandbox> = createPlayableSandbox,
  ) {}

  async extract(input: {
    analysisId: string
    video: Uint8Array
    seconds: number[]
    abortSignal?: AbortSignal
  }): Promise<(Uint8Array | null)[] | 'unavailable'> {
    const sandbox = await this.createSandbox(`keyframes-${input.analysisId}`, input.abortSignal)
    try {
      const probe = await sandbox.run({ command: 'ffmpeg -hide_banner -version', abortSignal: input.abortSignal })
      if (probe.exitCode !== 0) return 'unavailable'
      const directory = path.posix.join(sandbox.defaultWorkingDirectory, 'reference-keyframes')
      await sandbox.run({ command: `mkdir -p ${shellQuote(directory)}`, abortSignal: input.abortSignal })
      const videoPath = path.posix.join(directory, 'reference-video')
      await sandbox.writeBinaryFile({ path: videoPath, content: input.video, abortSignal: input.abortSignal })
      const frames: (Uint8Array | null)[] = []
      for (const [index, seconds] of input.seconds.entries()) {
        input.abortSignal?.throwIfAborted()
        const output = path.posix.join(directory, `${index + 1}.jpg`)
        const command = ['ffmpeg', ...keyframeFfmpegArgs(videoPath, seconds, output)].map(shellQuote).join(' ')
        const result = await sandbox.run({ command, abortSignal: input.abortSignal })
        const bytes =
          result.exitCode === 0 ? await sandbox.readBinaryFile({ path: output, abortSignal: input.abortSignal }) : null
        frames.push(bytes?.byteLength ? bytes : null)
      }
      return frames
    } finally {
      await Promise.resolve(sandbox.destroy()).catch(() => undefined)
    }
  }
}

const execFileAsync = promisify(execFile)

/** For `LOCAL_CODEX_MODE`, which has no remote snapshot: whatever ffmpeg is on PATH. */
export class LocalFfmpegReferenceKeyframeExtractor implements ReferenceKeyframeExtractor {
  async extract(input: {
    analysisId: string
    video: Uint8Array
    seconds: number[]
    abortSignal?: AbortSignal
  }): Promise<(Uint8Array | null)[] | 'unavailable'> {
    try {
      await execFileAsync('ffmpeg', ['-hide_banner', '-version'], { signal: input.abortSignal })
    } catch {
      input.abortSignal?.throwIfAborted()
      return 'unavailable'
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), 'playable-keyframes-'))
    try {
      const videoPath = path.join(directory, 'reference-video')
      await writeFile(videoPath, input.video)
      const frames: (Uint8Array | null)[] = []
      for (const [index, seconds] of input.seconds.entries()) {
        input.abortSignal?.throwIfAborted()
        const output = path.join(directory, `${index + 1}.jpg`)
        try {
          await execFileAsync('ffmpeg', keyframeFfmpegArgs(videoPath, seconds, output), { signal: input.abortSignal })
          const bytes = new Uint8Array(await readFile(output))
          frames.push(bytes.byteLength ? bytes : null)
        } catch {
          input.abortSignal?.throwIfAborted()
          frames.push(null)
        }
      }
      return frames
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** What a build needs to know about the active video's keyframes. */
export interface ReferenceKeyframeSnapshot {
  status: ReferenceKeyframeStatus | null
  keyframes: ReferenceKeyframe[]
  images: ReferenceKeyframeImage[]
}

/** How long a build waits for keyframes still being cut (spec §5.2). */
export const REFERENCE_KEYFRAME_BUILD_WAIT_MS = 60_000
const REFERENCE_KEYFRAME_BUILD_POLL_MS = 3_000

const delay = (milliseconds: number, abortSignal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    abortSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortSignal.reason)
      },
      { once: true },
    )
  })

/**
 * Waits a bounded time for keyframes still being cut, then hands over
 * whatever exists. An empty result means "build without them", never a
 * failure: they are extra evidence (spec §7).
 */
export async function loadReferenceKeyframesForBuild(input: {
  read: () => Promise<ReferenceKeyframeSnapshot | undefined>
  artifactStore: Pick<ArtifactStore, 'get'>
  waitMs?: number
  pollMs?: number
  sleep?: (milliseconds: number, abortSignal?: AbortSignal) => Promise<void>
  abortSignal?: AbortSignal
}): Promise<ReferenceKeyframeBuildInput[]> {
  const sleep = input.sleep ?? delay
  const deadline = Date.now() + (input.waitMs ?? REFERENCE_KEYFRAME_BUILD_WAIT_MS)
  let snapshot = await input.read()
  while (snapshot && (snapshot.status === 'pending' || snapshot.status === 'extracting') && Date.now() < deadline) {
    await sleep(input.pollMs ?? REFERENCE_KEYFRAME_BUILD_POLL_MS, input.abortSignal)
    snapshot = await input.read()
  }
  if (!snapshot || snapshot.status !== 'succeeded') return []
  const loaded: ReferenceKeyframeBuildInput[] = []
  for (const image of snapshot.images) {
    const keyframe = snapshot.keyframes[image.keyframeIndex]
    if (!keyframe) continue
    const stream = await input.artifactStore.get(image.storageKey)
    if (!stream) continue
    loaded.push({
      seconds: keyframe.seconds,
      focus: keyframe.focus,
      mimeType: image.mimeType,
      bytes: await readAll(stream),
    })
  }
  return loaded
}

export function referenceKeyframeStorageKey(
  task: Pick<PlayableTaskRecord, 'id' | 'userId'>,
  analysisId: string,
  keyframeIndex: number,
): string {
  // Indices only: nothing the model wrote reaches a storage path.
  return `users/${task.userId}/tasks/${task.id}/analyses/${analysisId}/keyframes/${keyframeIndex + 1}.jpg`
}

export interface RunReferenceKeyframeExtractionInput {
  task: PlayableTaskRecord
  asset: PlayableAsset
  /** The succeeded analysis whose blueprint picked the keyframes. */
  analysis: PlayableVideoAnalysisRecord
  repository: Pick<PlayableTaskRepository, 'saveReferenceKeyframes' | 'appendEvent'>
  artifactStore: Pick<ArtifactStore, 'get' | 'put'>
  /** Undefined where cutting frames is not possible at all, such as local demo mode. */
  extractor?: ReferenceKeyframeExtractor
  abortSignal?: AbortSignal
}

/**
 * Never throws and never fails anything but the keyframes: they are extra
 * evidence for the build, not something worth stopping an analysis or a
 * build over (spec §7).
 */
export async function runReferenceKeyframeExtraction(
  input: RunReferenceKeyframeExtractionInput,
): Promise<ReferenceKeyframeStatus> {
  const keyframes = input.analysis.blueprint?.keyframes ?? []
  const save = (status: ReferenceKeyframeStatus, images: ReferenceKeyframeImage[] = []) =>
    input.repository.saveReferenceKeyframes({
      assetId: input.analysis.assetId,
      pipelineVersion: input.analysis.pipelineVersion,
      model: input.analysis.model,
      fromAttempt: input.analysis.attempt,
      keyframes,
      status,
      images,
    })
  const event = (type: string, message: string) =>
    input.repository.appendEvent({ taskId: input.task.id, type, message }).catch(() => undefined)

  try {
    if (!input.analysis.blueprint || keyframes.length === 0) {
      await save('succeeded')
      return 'succeeded'
    }
    if (!input.extractor) {
      await save('unavailable')
      await event('reference_keyframes_unavailable', 'Reference keyframes are unavailable')
      return 'unavailable'
    }
    await save('extracting')
    await event('reference_keyframes_started', 'Reference keyframe extraction started')
    const stream = await input.artifactStore.get(input.asset.storageKey)
    if (!stream) throw new Error('Reference video is missing')
    const frames = await input.extractor.extract({
      analysisId: input.analysis.id,
      video: await readAll(stream),
      seconds: keyframes.map((keyframe) => keyframe.seconds),
      abortSignal: input.abortSignal,
    })
    if (frames === 'unavailable') {
      await save('unavailable')
      await event('reference_keyframes_unavailable', 'Reference keyframes are unavailable')
      return 'unavailable'
    }
    const images: ReferenceKeyframeImage[] = []
    for (const [keyframeIndex, bytes] of frames.entries()) {
      if (!bytes || keyframeIndex >= keyframes.length) continue
      const storageKey = referenceKeyframeStorageKey(input.task, input.analysis.id, keyframeIndex)
      await input.artifactStore.put(storageKey, bytes, 'image/jpeg')
      images.push({ keyframeIndex, storageKey, mimeType: 'image/jpeg' })
    }
    if (images.length === 0) throw new Error('No reference keyframe could be cut')
    await save('succeeded', images)
    await event('reference_keyframes_ready', 'Reference keyframes are ready')
    return 'succeeded'
  } catch {
    console.error('Reference keyframe extraction failed')
    await save('failed').catch(() => undefined)
    await event('reference_keyframes_failed', 'Reference keyframe extraction failed')
    return 'failed'
  }
}
