import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const database = vi.hoisted(() => {
  const limit = vi.fn()
  const where = vi.fn((_condition: unknown) => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { select, from, where, limit }
})

vi.mock('@/lib/db/client', () => ({
  db: { select: database.select },
}))

import { assertTaskOwner, NotFoundError } from '@/lib/playable/task-access'

describe('assertTaskOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the task when both task and user identifiers match', async () => {
    const ownedTask = { id: 'task-123', userId: 'user-123' }
    database.limit.mockResolvedValueOnce([ownedTask])

    await expect(assertTaskOwner('task-123', 'user-123')).resolves.toBe(ownedTask)

    const condition = database.where.mock.calls[0][0] as SQL
    const query = new PgDialect().sqlToQuery(condition)
    expect(query.sql).toContain('"tasks"."id" = $1')
    expect(query.sql).toContain('"tasks"."user_id" = $2')
    expect(query.params).toEqual(['task-123', 'user-123'])
    expect(database.limit).toHaveBeenCalledWith(1)
  })

  it.each([
    ['missing task', 'task-missing', 'user-123'],
    ['another user task', 'task-123', 'user-other'],
  ])('uses the same generic not-found error for %s', async (_case, taskId, userId) => {
    database.limit.mockResolvedValueOnce([])

    const error = await assertTaskOwner(taskId, userId).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NotFoundError)
    expect(error).toMatchObject({
      name: 'NotFoundError',
      message: 'Task not found',
      statusCode: 404,
    })
  })
})
