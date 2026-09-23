import { bindSourceTemplate, selectedSourceTemplate } from '@/lib/playable/source-template'
import { notFound } from 'next/navigation'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'
import { DatabasePlayableTaskRepository } from '@/lib/playable/task-repository'
import { Metadata } from 'next'
import { isLocalDemoMode, localDemoRuntime, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, isLocalHarnessMode, localCodexSession } from '@/lib/playable/local-codex-runtime'
import { publicPlayableSession } from '@/lib/playable/public-access'
import { restorePlayableConversation } from '@/lib/playable/conversation'
import { safeValidationSummary } from '@/lib/playable/task-api'
import { VIDEO_ANALYSIS_PIPELINE_VERSION } from '@/lib/playable/video-gameplay-analyst'

interface TaskPageProps {
  params: Promise<{
    taskId: string
  }>
  searchParams: Promise<{
    version?: string
  }>
}

export default async function TaskPage({ params, searchParams }: TaskPageProps) {
  const { taskId } = await params
  const { version } = await searchParams
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const localHarness = isLocalHarnessMode()
  const session = localDemo ? localDemoSession : localCodex || localHarness ? localCodexSession : publicPlayableSession
  const repository = localDemo ? localDemoRuntime.repository : new DatabasePlayableTaskRepository()
  const task = await repository.findOwnedTask(taskId, session.user.id)
  if (!task) notFound()
  const [storedMessages, initialAssets, latestVideoAnalysis, builds, events, referenceSelections] = await Promise.all([
    repository.listMessages(task.id),
    repository.listAssets(task.id, session.user.id),
    repository.findLatestVideoAnalysis(task.id, VIDEO_ANALYSIS_PIPELINE_VERSION),
    repository.listBuilds(task.id),
    repository.listEvents(task.id),
    repository.listReferenceSelections?.(task.id, session.user.id) ?? Promise.resolve([]),
  ])
  // The newest analysis may belong to a video that is no longer active. That is
  // "not analysed yet" for the page, the same rule the analysis route applies.
  const videoAnalysis =
    latestVideoAnalysis && latestVideoAnalysis.assetId === task.activeReferenceVideoAssetId
      ? latestVideoAnalysis
      : undefined
  // The blueprint comes from the newest succeeded attempt, so a re-run or an
  // intent comparison in flight does not blank it on reload.
  const blueprintAnalysis =
    videoAnalysis && videoAnalysis.status !== 'succeeded'
      ? await repository.findLatestSucceededVideoAnalysis(
          task.id,
          VIDEO_ANALYSIS_PIPELINE_VERSION,
          videoAnalysis.assetId,
        )
      : videoAnalysis
  const sourceTemplateId = selectedSourceTemplate(task)
  const initialConversation = restorePlayableConversation(
    storedMessages,
    task.pendingRevision,
    builds,
    referenceSelections,
  ).map((message) =>
    message.confirmation
      ? { ...message, confirmation: bindSourceTemplate(message.confirmation, sourceTemplateId) }
      : message,
  )
  const initialBuildFailureMessage =
    task.phase === 'failed' ? events.findLast((event) => event.type === 'build_failed')?.message : undefined

  // 切换任务时重建工作区，避免草稿、排队需求和截图反馈沿用上一个任务的状态。
  return (
    <PlayableWorkspace
      key={task.id}
      taskId={task.id}
      initialPrompt={task.prompt}
      initialPhase={task.phase}
      initialProposal={
        task.phase === 'draft'
          ? undefined
          : task.confirmation
            ? bindSourceTemplate(task.confirmation, sourceTemplateId)
            : undefined
      }
      initialRevision={task.pendingRevision ?? undefined}
      initialBrief={task.requirementBrief ?? undefined}
      initialConversation={initialConversation}
      initialAssets={initialAssets.map(({ id, slot, filename, mimeType, size, durationSeconds }) => ({
        id,
        slot,
        filename,
        mimeType,
        size,
        durationSeconds,
      }))}
      initialVideoAnalysisStatus={videoAnalysis?.status}
      initialGameplayBlueprint={blueprintAnalysis?.blueprint ?? undefined}
      initialVideoAnalysisMediaResolution={blueprintAnalysis?.mediaResolution ?? null}
      initialActiveReferenceVideoId={task.activeReferenceVideoAssetId}
      initialGameplayAnnotations={task.gameplayAnnotations.filter(
        (annotation) => annotation.assetId === task.activeReferenceVideoAssetId,
      )}
      initialHasArtifact={Boolean(task.latestArtifactKey)}
      initialArtifactVersion={task.latestArtifactKey?.split('/').at(-2) ?? null}
      initialBuildId={version}
      initialBuildFailureMessage={initialBuildFailureMessage}
      initialValidation={safeValidationSummary(task.latestValidation, task.confirmation?.delivery)}
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
