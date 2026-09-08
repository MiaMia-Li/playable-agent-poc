import { after } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import { generateId } from '@/lib/utils/id'
import { PrivateVercelArtifactStore } from './artifact-store'
import { readOpenAIKeyCookie } from './byok-session'
import { CodexPlayableAgent } from './codex-playable-agent'
import { createPlayableTaskHandlers } from './task-api'
import { DatabasePlayableTaskRepository } from './task-repository'
import { createPlayableAssetHandler } from './task-assets'
import { authenticateLocalDemo, isLocalDemoMode, localDemoRuntime, readLocalDemoApiKey } from './local-demo-prototype'
import { CodexCliPlayableAgent } from './codex-cli-playable-agent'
import { authenticateLocalCodex, isLocalCodexMode, readLocalCodexAuthMarker } from './local-codex-runtime'

const localDemo = isLocalDemoMode()
const localCodex = isLocalCodexMode()

export const playableTaskRepository = localDemo ? localDemoRuntime.repository : new DatabasePlayableTaskRepository()
export const playableArtifactStore = localDemo ? localDemoRuntime.artifactStore : new PrivateVercelArtifactStore()
const playableAgent = localDemo
  ? localDemoRuntime.agent
  : localCodex
    ? new CodexCliPlayableAgent()
    : new CodexPlayableAgent()

const authenticate = localDemo
  ? authenticateLocalDemo
  : localCodex
    ? authenticateLocalCodex
    : async (request: Parameters<typeof getSessionFromReq>[0]) => (await getSessionFromReq(request))?.user.id

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
  store: playableArtifactStore,
  generateId,
})
