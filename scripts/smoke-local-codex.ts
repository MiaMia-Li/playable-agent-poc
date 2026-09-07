import { PrivateVercelArtifactStore } from '@/lib/playable/artifact-store'
import { CodexCliPlayableAgent } from '@/lib/playable/codex-cli-playable-agent'
import { authenticateLocalCodex, readLocalCodexAuthMarker } from '@/lib/playable/local-codex-runtime'
import { runConfirmedBuild } from '@/lib/playable/task-api'
import { DatabasePlayableTaskRepository } from '@/lib/playable/task-repository'
import { generateId } from '@/lib/utils/id'

async function main() {
  console.log('Starting local Codex end-to-end smoke test')
  const repository = new DatabasePlayableTaskRepository()
  const artifactStore = new PrivateVercelArtifactStore()
  const agent = new CodexCliPlayableAgent()
  const userId = await authenticateLocalCodex()
  const apiKey = await readLocalCodexAuthMarker()
  const task = await repository.createTask({
    id: generateId(),
    userId,
    prompt: '制作一个中心碰撞麻将配对试玩，使用内置素材，中文文案。',
  })

  console.log('Generating confirmation with Codex CLI')
  const confirmation = await agent.proposeConfirmation({
    taskId: task.id,
    prompt: task.prompt,
    apiKey,
  })
  await repository.appendMessage(task.id, 'user', task.prompt)
  await repository.appendMessage(task.id, 'agent', JSON.stringify(confirmation))
  if (!(await repository.setAwaitingConfirmation(task.id, userId, confirmation))) {
    throw new Error('Unable to save confirmation')
  }
  const claimed = await repository.claimBuild(task.id, userId, confirmation)
  if (!claimed) throw new Error('Unable to claim playable build')

  console.log('Building with Codex CLI and Vercel Sandbox')
  await runConfirmedBuild({
    task: claimed,
    apiKey,
    buildId: generateId(),
    repository,
    agent,
    artifactStore,
  })

  const completed = await repository.findOwnedTask(task.id, userId)
  if (completed?.phase !== 'ready' || !completed.latestArtifactKey) {
    throw new Error('Playable build did not reach ready state')
  }
  const artifact = await artifactStore.get(completed.latestArtifactKey)
  if (!artifact) throw new Error('Playable artifact could not be read')
  const html = await new Response(artifact).text()
  if (!html.includes('window.__PLAYABLE__')) throw new Error('Playable artifact contract is missing')
  console.log('Local Codex end-to-end smoke test passed')
  process.exit(0)
}

main().catch(() => {
  console.error('Local Codex end-to-end smoke test failed')
  process.exit(1)
})
