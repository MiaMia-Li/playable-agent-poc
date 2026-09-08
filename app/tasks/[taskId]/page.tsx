import { notFound, redirect } from 'next/navigation'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'
import { getServerSession } from '@/lib/session/get-server-session'
import { DatabasePlayableTaskRepository } from '@/lib/playable/task-repository'
import { Metadata } from 'next'
import { isLocalDemoMode, localDemoRuntime, localDemoSession } from '@/lib/playable/local-demo-prototype'
import { isLocalCodexMode, localCodexSession } from '@/lib/playable/local-codex-runtime'
import { playableAgentReplySchema } from '@/lib/playable/schemas'
import type { ConversationMessage } from '@/components/playable/chat-workspace'

interface TaskPageProps {
  params: Promise<{
    taskId: string
  }>
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { taskId } = await params
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const session = localDemo ? localDemoSession : localCodex ? localCodexSession : await getServerSession()
  if (!session?.user?.id) redirect('/')
  const repository = localDemo ? localDemoRuntime.repository : new DatabasePlayableTaskRepository()
  const task = await repository.findOwnedTask(taskId, session.user.id)
  if (!task) notFound()
  const storedMessages = await repository.listMessages(task.id)
  const initialConversation = storedMessages.flatMap((stored): ConversationMessage[] => {
    if (stored.role === 'user') {
      return [{ id: stored.id, role: 'user', content: stored.content, status: 'sent' }]
    }
    try {
      const parsed = playableAgentReplySchema.safeParse(JSON.parse(stored.content))
      if (!parsed.success) return []
      return [
        {
          id: stored.id,
          role: 'assistant',
          content: parsed.data.message,
          reasoning: parsed.data.reasoning,
          options: parsed.data.kind === 'clarification' ? parsed.data.options : undefined,
          status: 'sent',
        },
      ]
    } catch {
      return []
    }
  })

  return (
    <PlayableWorkspace
      taskId={task.id}
      initialPrompt={task.prompt}
      initialPhase={task.phase}
      initialProposal={task.phase === 'draft' ? undefined : (task.confirmation ?? undefined)}
      initialConversation={initialConversation}
      initialHasArtifact={Boolean(task.latestArtifactKey)}
      initialArtifactVersion={task.latestArtifactKey?.split('/').at(-2) ?? null}
      initialApiKeyConfigured={localDemo || localCodex ? true : undefined}
      localDemo={localDemo}
      localCodex={localCodex}
    />
  )
}

export async function generateMetadata({ params }: TaskPageProps): Promise<Metadata> {
  const { taskId } = await params
  const localDemo = isLocalDemoMode()
  const localCodex = isLocalCodexMode()
  const session = localDemo ? localDemoSession : localCodex ? localCodexSession : await getServerSession()

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
