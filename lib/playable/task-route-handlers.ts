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

const localDemo = isLocalDemoMode()

export const playableTaskRepository = localDemo ? localDemoRuntime.repository : new DatabasePlayableTaskRepository()
export const playableArtifactStore = localDemo ? localDemoRuntime.artifactStore : new PrivateVercelArtifactStore()
const playableAgent = localDemo ? localDemoRuntime.agent : new CodexPlayableAgent()

export const playableTaskHandlers = createPlayableTaskHandlers({
  authenticate: localDemo ? authenticateLocalDemo : async (request) => (await getSessionFromReq(request))?.user.id,
  readApiKey: localDemo ? readLocalDemoApiKey : readOpenAIKeyCookie,
  repository: playableTaskRepository,
  agent: playableAgent,
  artifactStore: playableArtifactStore,
  schedule: localDemo ? (work) => void work().catch(() => undefined) : (work) => after(work),
  generateId,
})

export const playableAssetHandler = createPlayableAssetHandler({
  authenticate: localDemo ? authenticateLocalDemo : async (request) => (await getSessionFromReq(request))?.user.id,
  findOwnedTask: async (taskId, userId) => Boolean(await playableTaskRepository.findOwnedTask(taskId, userId)),
  saveAsset: (asset) => playableTaskRepository.saveAsset(asset),
  store: playableArtifactStore,
  generateId,
})
