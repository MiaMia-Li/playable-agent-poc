import { after } from 'next/server'
import { generateId } from '@/lib/utils/id'
import { PrivateVercelArtifactStore } from './artifact-store'
import { readOpenAIKeyCookie } from './byok-session'
import { CodexPlayableAgent } from './codex-playable-agent'
import { createPlayableTaskHandlers } from './task-api'
import { DatabasePlayableTaskRepository } from './task-repository'
import {
  createPlayableAssetContentHandler,
  createPlayableAssetDeleteHandler,
  createPlayableAssetHandler,
} from './task-assets'
import { authenticateLocalDemo, isLocalDemoMode, localDemoRuntime, readLocalDemoApiKey } from './local-demo-prototype'
import { CodexCliPlayableAgent } from './codex-cli-playable-agent'
import {
  authenticateLocalCodex,
  isLocalCodexMode,
  isLocalHarnessMode,
  readLocalCodexAuthMarker,
} from './local-codex-runtime'
import { authenticatePublicPlayable } from './public-access'

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

const authenticate = localDemo
  ? authenticateLocalDemo
  : localCodex || localHarness
    ? authenticateLocalCodex
    : authenticatePublicPlayable

export const playableTaskHandlers = createPlayableTaskHandlers({
  authenticate,
  readApiKey: localDemo ? readLocalDemoApiKey : localCodex ? readLocalCodexAuthMarker : readOpenAIKeyCookie,
  readMediaApiKey: localCodex ? readOpenAIKeyCookie : undefined,
  repository: playableTaskRepository,
  agent: playableAgent,
  artifactStore: playableArtifactStore,
  schedule: localDemo ? (work) => void work().catch(() => undefined) : (work) => after(work),
  mediaGenerator: localDemo ? localDemoRuntime.mediaGenerator : undefined,
  generateId,
})

export const playableAssetHandler = createPlayableAssetHandler({
  authenticate,
  findOwnedTask: async (taskId, userId) => Boolean(await playableTaskRepository.findOwnedTask(taskId, userId)),
  saveAsset: (asset) => playableTaskRepository.saveAsset(asset),
  listAssets: (taskId, userId) => playableTaskRepository.listAssets(taskId, userId),
  store: playableArtifactStore,
  generateId,
})

const playableAssetAccessDependencies = {
  authenticate,
  findOwnedAsset: (taskId: string, userId: string, assetId: string) =>
    playableTaskRepository.findOwnedAsset(taskId, userId, assetId),
  deleteOwnedAsset: (taskId: string, userId: string, assetId: string) =>
    playableTaskRepository.deleteOwnedAsset(taskId, userId, assetId),
  store: playableArtifactStore,
}

export const playableAssetContentHandler = createPlayableAssetContentHandler(playableAssetAccessDependencies)
export const playableAssetDeleteHandler = createPlayableAssetDeleteHandler(playableAssetAccessDependencies)
