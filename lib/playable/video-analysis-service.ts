import type { ArtifactStore } from './artifact-store'
import { redactSecrets } from './redact'
import { gameplayBlueprintSchema, type GameplayBlueprint } from './schemas'
import { readGeminiApiKey, readGeminiBaseUrl } from './shared-ai-key'
import type { PlayableTaskRecord, PlayableTaskRepository, PlayableVideoAnalysisRecord } from './task-api'
import type { PlayableAsset } from './task-assets'
import type { VideoGameplayAnalyst } from './video-gameplay-analyst'

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
    const result = await input.analyst.analyze({
      taskId: input.task.id,
      prompt: input.task.prompt,
      video: {
        bytes,
        mimeType: input.asset.mimeType,
        durationSeconds: input.asset.durationSeconds ?? undefined,
      },
      abortSignal: input.abortSignal,
    })
    // A blueprint is free model text, so it can echo anything that was in the
    // request. Both the Gemini key and the gateway address have to be covered,
    // not just whichever one the caller happened to pass in.
    const sanitizedBlueprint = gameplayBlueprintSchema.parse(
      JSON.parse(
        redactSecrets(
          JSON.stringify(result.blueprint),
          [readGeminiApiKey() ?? '', readGeminiBaseUrl()].filter(Boolean),
        ),
      ),
    )
    await input.repository.completeVideoAnalysis(input.analysis.id, sanitizedBlueprint, result.mediaResolution)
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
