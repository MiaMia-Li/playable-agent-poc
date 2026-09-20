import { after } from 'next/server'
import { readBuildSandboxState } from './build-sandbox-state'
import { generateId } from '@/lib/utils/id'
import { PrivateVercelArtifactStore } from './artifact-store'
import { readSharedPlayableAIKey } from './shared-ai-key'
import { CodexPlayableAgent } from './codex-playable-agent'
import { createPlayableTaskHandlers } from './task-api'
import { DatabasePlayableTaskRepository } from './task-repository'
import {
  createPlayableAssetContentHandler,
  createPlayableAssetDeleteHandler,
  createPlayableAssetHandler,
  createPlayableAssetUploadCompleteHandler,
  createPlayableAssetUploadTokenHandler,
  type PlayableAsset,
} from './task-assets'
import { authenticateLocalDemo, isLocalDemoMode, localDemoRuntime, readLocalDemoApiKey } from './local-demo-prototype'
import { CodexCliPlayableAgent } from './codex-cli-playable-agent'
import {
  authenticateLocalCodex,
  isLocalCodexMode,
  isLocalHarnessMode,
  readLocalCodexAuthMarker,
} from './local-codex-runtime'
import { createVideoGameplayAnalyst } from './video-analysis-backend'
import { authenticatePublicPlayable } from './public-access'
import { CodexCliReferenceImageAnalyst, OpenAIReferenceImageAnalyst } from './reference-image-analyst'
import { OpenAIMarketResearchAgent } from './research/openai-market-research-agent'
import { LocalFfmpegReferenceKeyframeExtractor, SandboxReferenceKeyframeExtractor } from './reference-keyframes'

const localDemo = isLocalDemoMode()
const localCodex = isLocalCodexMode()
const localHarness = isLocalHarnessMode()

export const playableTaskRepository = localDemo ? localDemoRuntime.repository : new DatabasePlayableTaskRepository()
export const playableArtifactStore = localDemo ? localDemoRuntime.artifactStore : new PrivateVercelArtifactStore()
const playableAgent = localDemo
  ? localDemoRuntime.agent
  : localCodex
    ? new CodexCliPlayableAgent()
    : new CodexPlayableAgent()
// Wired in every mode, including local demo. Availability is decided by the
// configured backend and its key, not by which runtime is active, so that
// "no key, no analysis" means the same thing everywhere. Leaving this
// undefined is the single signal the handlers read; they do not look at the
// environment themselves.
const videoAnalyst = createVideoGameplayAnalyst()
const imageAnalyst = localDemo
  ? undefined
  : localCodex
    ? new CodexCliReferenceImageAnalyst()
    : new OpenAIReferenceImageAnalyst()
const marketResearchAgent = localDemo ? localDemoRuntime.marketResearchAgent : new OpenAIMarketResearchAgent()
// Local demo cuts no frames; local Codex has no remote snapshot and uses the
// ffmpeg on PATH; everything else restores the build snapshot (ADR 0003).
const keyframeExtractor = localDemo
  ? undefined
  : localCodex
    ? new LocalFfmpegReferenceKeyframeExtractor()
    : new SandboxReferenceKeyframeExtractor()

const authenticate = localDemo
  ? authenticateLocalDemo
  : localCodex || localHarness
    ? authenticateLocalCodex
    : authenticatePublicPlayable

export const playableTaskHandlers = createPlayableTaskHandlers({
  authenticate,
  readApiKey: localDemo ? readLocalDemoApiKey : localCodex ? readLocalCodexAuthMarker : () => readSharedPlayableAIKey(),
  readMediaApiKey: localCodex ? () => readSharedPlayableAIKey() : undefined,
  repository: playableTaskRepository,
  // 轮询可能落到另一服务实例，使用远程查询而非进程内的 Agent 状态。
  readBuildSandboxState,
  agent: playableAgent,
  artifactStore: playableArtifactStore,
  schedule: localDemo ? (work) => void work().catch(() => undefined) : (work) => after(work),
  mediaGenerator: localDemo ? localDemoRuntime.mediaGenerator : undefined,
  imageAnalyst,
  videoAnalyst,
  keyframeExtractor,
  marketResearchAgent,
  generateId,
})

const playableAssetUploadDependencies = {
  authenticate,
  findOwnedTask: async (taskId: string, userId: string) =>
    Boolean(await playableTaskRepository.findOwnedTask(taskId, userId)),
  saveAsset: (asset: PlayableAsset) => playableTaskRepository.saveAsset(asset),
  listAssets: (taskId: string, userId: string) => playableTaskRepository.listAssets(taskId, userId),
  activateReferenceVideo: async (taskId: string, userId: string, assetId: string) => {
    await playableTaskRepository.setActiveReferenceVideo(taskId, userId, assetId)
  },
  store: playableArtifactStore,
  directUploads: playableArtifactStore instanceof PrivateVercelArtifactStore ? playableArtifactStore : undefined,
  generateId,
}

export const playableAssetHandler = createPlayableAssetHandler(playableAssetUploadDependencies)
export const playableAssetUploadTokenHandler = createPlayableAssetUploadTokenHandler(playableAssetUploadDependencies)
export const playableAssetUploadCompleteHandler = createPlayableAssetUploadCompleteHandler(
  playableAssetUploadDependencies,
)

const playableAssetAccessDependencies = {
  authenticate,
  findOwnedAsset: (taskId: string, userId: string, assetId: string) =>
    playableTaskRepository.findOwnedAsset(taskId, userId, assetId),
  deleteOwnedAsset: (taskId: string, userId: string, assetId: string) =>
    playableTaskRepository.deleteOwnedAsset(taskId, userId, assetId),
  store: playableArtifactStore,
}

export const playableAssetContentHandler = createPlayableAssetContentHandler(playableAssetAccessDependencies)
export const playableAssetDeleteHandler = createPlayableAssetDeleteHandler({
  ...playableAssetAccessDependencies,
  releaseReferenceVideo: async (taskId, userId, assetId) => {
    const task = await playableTaskRepository.findOwnedTask(taskId, userId)
    if (task?.activeReferenceVideoAssetId === assetId) {
      await playableTaskRepository.setActiveReferenceVideo(taskId, userId, null)
    }
  },
})
