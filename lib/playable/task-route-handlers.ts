import { after } from 'next/server'
import { getSessionFromReq } from '@/lib/session/server'
import { generateId } from '@/lib/utils/id'
import { PrivateVercelArtifactStore } from './artifact-store'
import { readOpenAIKeyCookie } from './byok-session'
import { CodexPlayableAgent } from './codex-playable-agent'
import { createPlayableTaskHandlers } from './task-api'
import { DatabasePlayableTaskRepository } from './task-repository'

export const playableTaskHandlers = createPlayableTaskHandlers({
  authenticate: async (request) => (await getSessionFromReq(request))?.user.id,
  readApiKey: readOpenAIKeyCookie,
  repository: new DatabasePlayableTaskRepository(),
  agent: new CodexPlayableAgent(),
  artifactStore: new PrivateVercelArtifactStore(),
  schedule: (work) => after(work),
  generateId,
})
