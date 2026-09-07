import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'

export class NotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Task not found')
    this.name = 'NotFoundError'
  }
}

export async function assertTaskOwner(taskId: string, userId: string): Promise<typeof tasks.$inferSelect> {
  const result = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1)

  if (!result[0]) {
    throw new NotFoundError()
  }

  return result[0]
}
