import { notFound } from 'next/navigation'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'
import { DatabasePlayableTaskRepository } from '@/lib/playable/task-repository'
import { Metadata } from 'next'
import { isLocalDemoMode, localDemoRuntime, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, isLocalHarnessMode, localCodexSession } from '@/lib/playable/local-codex-runtime'
import { publicPlayableSession } from '@/lib/playable/public-access'
import { restorePlayableConversation } from '@/lib/playable/conversation'
import { safeValidationSummary } from '@/lib/playable/task-api'

interface TaskPageProps {
  params: Promise<{
    taskId: string
  }>
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { taskId } = await params
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo ? localDemoSession : localCodex || localHarness ? localCodexSession : publicPlayableSession
  const repository = localDemo ? localDemoRuntime.repository : new DatabasePlayableTaskRepository()
  const task = await repository.findOwnedTask(taskId, session.user.id)
  if (!task) notFound()
  const [storedMessages, initialAssets, videoAnalysis, builds, events] = await Promise.all([
    repository.listMessages(task.id),
    repository.listAssets(task.id, session.user.id),
    repository.findLatestVideoAnalysis(task.id),
    repository.listBuilds(task.id),
    repository.listEvents(task.id),
  ])
  const initialConversation = restorePlayableConversation(storedMessages, task.pendingRevision, builds)
  const initialBuildFailureMessage =
    task.phase === 'failed' ? events.findLast((event) => event.type === 'build_failed')?.message : undefined

  return (
    <PlayableWorkspace
      taskId={task.id}
      initialPrompt={task.prompt}
      initialPhase={task.phase}
      initialProposal={task.phase === 'draft' ? undefined : (task.confirmation ?? undefined)}
      initialRevision={task.pendingRevision ?? undefined}
      initialBrief={task.requirementBrief ?? undefined}
      initialConversation={initialConversation}
      initialAssets={initialAssets.map(({ id, slot, filename, mimeType, size }) => ({
        id,
        slot,
        filename,
        mimeType,
        size,
      }))}
      initialVideoAnalysisStatus={videoAnalysis?.status}
      initialGameplayBlueprint={videoAnalysis?.blueprint ?? undefined}
      initialHasArtifact={Boolean(task.latestArtifactKey)}
      initialArtifactVersion={task.latestArtifactKey?.split('/').at(-2) ?? null}
      initialBuildFailureMessage={initialBuildFailureMessage}
      initialValidation={safeValidationSummary(task.latestValidation, task.confirmation?.delivery)}
      initialApiKeyConfigured={localDemo || localCodex ? true : undefined}
      localDemo={localDemo}
      localCodex={localCodex}
      localHarness={localHarness}
      publicAccess={!localDemo && !localCodex && !localHarness}
    />
  )
}

export async function generateMetadata({ params }: TaskPageProps): Promise<Metadata> {
  const { taskId } = await params
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo ? localDemoSession : localCodex || localHarness ? localCodexSession : publicPlayableSession

  let pageTitle = `试玩 ${taskId}`

  if (session?.user?.id) {
    try {
      if (localDemo) {
        const task = await localDemoRuntime.repository.findOwnedTask(taskId, session.user.id)
        if (task?.title) pageTitle = task.title
        else if (task?.prompt) pageTitle = task.prompt.length > 60 ? `${task.prompt.slice(0, 60)}...` : task.prompt
        return {
          title: `${pageTitle} - Playable Studio`,
          description: '创建、确认并预览 AI 生成的试玩广告',
        }
      }
      const { db } = await import('@/lib/db/client')
      const { tasks } = await import('@/lib/db/schema')
      const { eq, and, isNull } = await import('drizzle-orm')

      const task = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
        .limit(1)

      if (task[0]?.title) pageTitle = task[0].title
      else if (task[0]?.prompt)
        pageTitle = task[0].prompt.length > 60 ? `${task[0].prompt.slice(0, 60)}...` : task[0].prompt
    } catch {
      // If fetching fails, fall back to task ID
      console.error('Failed to fetch task for metadata')
    }
  }

  return {
    title: `${pageTitle} - Playable Studio`,
    description: '创建、确认并预览 AI 生成的试玩广告',
  }
}
