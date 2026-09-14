import type { ArtifactStore } from './artifact-store'
import { redactSecrets } from './redact'
import { gameplayBlueprintSchema, type GameplayBlueprint } from './schemas'
import { readVideoAnalysisSecrets } from './shared-ai-key'
import type { PlayableTaskRecord, PlayableTaskRepository, PlayableVideoAnalysisRecord } from './task-api'
import type { PlayableAsset } from './task-assets'
import type { VideoGameplayAnalyst } from './video-gameplay-analyst'
import { deriveGameplayIntent } from './gameplay-intent'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.byteLength
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * The whole run, retries included, must end inside the analysis route's
 * `maxDuration` (800 seconds in `vercel.json`). A function the platform kills
 * never reaches `failVideoAnalysis`, so aborting first is what turns a timeout
 * into a recorded failure instead of a row stuck in `analyzing`. The margin
 * covers the Blob read and the writes that follow the model call.
 */
export const VIDEO_ANALYSIS_BUDGET_MS = 740_000

/**
 * A blueprint is free model text, so it can echo anything that was in the
 * request. Every backend's key, and the gateway address, have to be covered,
 * not just whichever one the caller happened to pass in.
 */
function sanitizeBlueprint(blueprint: GameplayBlueprint): GameplayBlueprint {
  const secrets = readVideoAnalysisSecrets()
  return gameplayBlueprintSchema.parse(JSON.parse(redactSecrets(JSON.stringify(blueprint), secrets)))
}

export interface RunVideoAnalysisInput {
  task: PlayableTaskRecord
  asset: PlayableAsset
  analysis: PlayableVideoAnalysisRecord
  repository: PlayableTaskRepository
  artifactStore: ArtifactStore
  analyst: VideoGameplayAnalyst
  abortSignal?: AbortSignal
}

export async function runVideoAnalysis(input: RunVideoAnalysisInput): Promise<GameplayBlueprint | undefined> {
  try {
    await input.repository.updateVideoAnalysisStatus(input.analysis.id, 'preprocessing')
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_preprocessing_started',
      message: 'Reference video preprocessing started',
    })
    const stream = await input.artifactStore.get(input.asset.storageKey)
    if (!stream) throw new Error('Reference video is missing')
    const bytes = await readAll(stream)
    await input.repository.updateVideoAnalysisStatus(input.analysis.id, 'analyzing')
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_gameplay_analysis_started',
      message: 'QDAI gameplay analysis started',
    })
    // Recorded with the result, so a later change of intent can be detected
    // and compared without watching the video again.
    const intent = deriveGameplayIntent(input.task.requirementBrief, input.task.prompt)
    const result = await input.analyst.analyze({
      taskId: input.task.id,
      prompt: intent,
      video: {
        bytes,
        mimeType: input.asset.mimeType,
        durationSeconds: input.asset.durationSeconds ?? undefined,
      },
      abortSignal: input.abortSignal,
    })
    const sanitizedBlueprint = sanitizeBlueprint(result.blueprint)
    await input.repository.completeVideoAnalysis(input.analysis.id, sanitizedBlueprint, result.mediaResolution, intent)
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_gameplay_analysis_succeeded',
      message:
        result.mediaResolution === 'high'
          ? 'Gameplay blueprint is ready'
          : 'Gameplay blueprint is ready, analysed at reduced resolution',
    })
    return sanitizedBlueprint
  } catch {
    console.error('QDAI video gameplay analysis failed')
    await input.repository.failVideoAnalysis(input.analysis.id, 'analysis_failed').catch(() => undefined)
    await input.repository
      .appendEvent({
        taskId: input.task.id,
        type: 'video_gameplay_analysis_failed',
        message: 'Reference video analysis failed',
      })
      .catch(() => undefined)
  }
}

export interface RunIntentComparisonInput {
  /** Id for the row this comparison records, if it gets to record one. */
  id: string
  task: PlayableTaskRecord
  asset: PlayableAsset
  /** The succeeded analysis being compared; its attempt number is the base. */
  analysis: PlayableVideoAnalysisRecord
  intent: string
  repository: PlayableTaskRepository
  analyst: VideoGameplayAnalyst
  abortSignal?: AbortSignal
}

/**
 * Recomputes intent divergence for intent that arrived after the video was
 * analysed, so uploading first and describing later ends up where describing
 * first would have.
 *
 * Only the divergence comes from the model; every other field is copied from
 * the stored blueprint here. The spec had the model copy the whole blueprint
 * back, guarded by a deep comparison. Copying it server side makes "the
 * original observation was not rewritten" structural, instead of a check that
 * fails whenever the model rewords an inference it was only meant to echo.
 *
 * Written as a new, already-succeeded row numbered after the analysis it
 * builds on. If anything else claimed that number first — a re-run of the
 * video — the insert loses and the result is dropped, since it describes a
 * blueprint that is no longer the latest.
 */
export async function runIntentComparison(input: RunIntentComparisonInput): Promise<boolean> {
  const base = input.analysis.blueprint
  if (!base) return false
  try {
    const intentDivergence = await input.analyst.compareIntent({
      blueprint: base,
      intent: input.intent,
      durationSeconds: input.asset.durationSeconds ?? undefined,
      abortSignal: input.abortSignal,
    })
    const recorded = await input.repository.recordIntentComparison({
      id: input.id,
      taskId: input.task.id,
      assetId: input.analysis.assetId,
      pipelineVersion: input.analysis.pipelineVersion,
      model: input.analysis.model,
      attempt: input.analysis.attempt + 1,
      blueprint: sanitizeBlueprint({ ...base, intentDivergence }),
      mediaResolution: input.analysis.mediaResolution,
      intentText: input.intent,
    })
    if (!recorded) return false
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_intent_divergence_updated',
      message: 'Gameplay blueprint compared against the updated intent',
    })
    return true
  } catch {
    console.error('Intent divergence comparison failed')
    await input.repository
      .appendEvent({
        taskId: input.task.id,
        type: 'video_intent_divergence_failed',
        message: 'Intent divergence comparison failed',
      })
      .catch(() => undefined)
    return false
  }
}
