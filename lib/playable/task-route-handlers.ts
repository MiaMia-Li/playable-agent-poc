import { after } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import { generateId } from '@/lib/utils/id'
import { PrivateVercelArtifactStore } from './artifact-store'
import { readOpenAIKeyCookie } from './byok-session'
import { CodexPlayableAgent } from './codex-playable-agent'
import { createPlayableTaskHandlers } from './task-api'
import { DatabasePlayableTaskRepository } from './task-repository'
import { createPlayableAssetHandler } from './task-assets'

export const playableTaskRepository = new DatabasePlayableTaskRepository()
export const playableArtifactStore = new PrivateVercelArtifactStore()

export const playableTaskHandlers = createPlayableTaskHandlers({
  authenticate: async (request) => (await getSessionFromReq(request))?.user.id,
  readApiKey: readOpenAIKeyCookie,
  repository: playableTaskRepository,
  agent: new CodexPlayableAgent(),
  artifactStore: playableArtifactStore,
  schedule: (work) => after(work),
  generateId,
})

export const playableAssetHandler = createPlayableAssetHandler({
  authenticate: async (request) => (await getSessionFromReq(request))?.user.id,
  findOwnedTask: async (taskId, userId) => Boolean(await playableTaskRepository.findOwnedTask(taskId, userId)),
  saveAsset: (asset) => playableTaskRepository.saveAsset(asset),
  store: playableArtifactStore,
  generateId,
})
