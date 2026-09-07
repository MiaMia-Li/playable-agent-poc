import { notFound, redirect } from 'next/navigation'
import { PlayableWorkspace } from '@/components/playable/playable-workspace'
import { getServerSession } from '@/lib/session/get-server-session'
import { DatabasePlayableTaskRepository } from '@/lib/playable/task-repository'
import { Metadata } from 'next'

interface TaskPageProps {
  params: Promise<{
    taskId: string
  }>
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { taskId } = await params
  const session = await getServerSession()
  if (!session?.user?.id) redirect('/')
  const task = await new DatabasePlayableTaskRepository().findOwnedTask(taskId, session.user.id)
  if (!task) notFound()

  return (
    <PlayableWorkspace
      taskId={task.id}
      initialPrompt={task.prompt}
      initialPhase={task.phase}
      initialProposal={task.confirmation ?? undefined}
    />
  )
}

export async function generateMetadata({ params }: TaskPageProps): Promise<Metadata> {
  const { taskId } = await params
  const session = await getServerSession()

  let pageTitle = `试玩 ${taskId}`

  if (session?.user?.id) {
    try {
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
    } catch (error) {
      // If fetching fails, fall back to task ID
      console.error('Failed to fetch task for metadata:', error)
    }
  }

  return {
    title: `${pageTitle} - Playable Studio`,
    description: '创建、确认并预览 AI 生成的试玩广告',
  }
}
