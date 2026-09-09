import type { ArtifactStore } from './artifact-store'
import { redactSecrets } from './redact'
import { gameplayBlueprintSchema } from './schemas'
import type { PlayableTaskRecord, PlayableTaskRepository, PlayableVideoAnalysisRecord } from './task-api'
import type { PlayableAsset } from './task-assets'
import type { VideoGameplayAnalyst } from './video-gameplay-analyst'
import type { VideoPreprocessor } from './video-preprocessor'

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

export interface RunVideoAnalysisInput {
  task: PlayableTaskRecord
  asset: PlayableAsset
  analysis: PlayableVideoAnalysisRecord
  apiKey: string
  repository: PlayableTaskRepository
  artifactStore: ArtifactStore
  preprocessor: VideoPreprocessor
  analyst: VideoGameplayAnalyst
}

export async function runVideoAnalysis(input: RunVideoAnalysisInput): Promise<void> {
  try {
    await input.repository.updateVideoAnalysisStatus(input.analysis.id, 'preprocessing')
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_preprocessing_started',
      message: 'Reference video preprocessing started',
    })
    const stream = await input.artifactStore.get(input.asset.storageKey)
    if (!stream) throw new Error('Reference video is missing')
    const video = await input.preprocessor.preprocess({
      taskId: input.task.id,
      video: await readAll(stream),
      mimeType: input.asset.mimeType,
    })
    await input.repository.updateVideoAnalysisStatus(input.analysis.id, 'analyzing')
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_gameplay_analysis_started',
      message: 'QDAI gameplay analysis started',
    })
    const blueprint = await input.analyst.analyze({
      taskId: input.task.id,
      apiKey: input.apiKey,
      prompt: input.task.prompt,
      video,
    })
    const sanitizedBlueprint = gameplayBlueprintSchema.parse(
      JSON.parse(redactSecrets(JSON.stringify(blueprint)).split(input.apiKey).join('[REDACTED]')),
    )
    await input.repository.completeVideoAnalysis(input.analysis.id, sanitizedBlueprint)
    await input.repository.appendEvent({
      taskId: input.task.id,
      type: 'video_gameplay_analysis_succeeded',
      message: 'Gameplay blueprint is ready',
    })
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
