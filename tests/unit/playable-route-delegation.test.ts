import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const handlers = vi.hoisted(() => ({
  create: vi.fn(async () => new Response(null, { status: 201 })),
  message: vi.fn(async () => new Response(null)),
  confirm: vi.fn(async () => new Response(null, { status: 202 })),
  events: vi.fn(async () => new Response(null)),
  artifact: vi.fn(async () => new Response(null)),
}))

vi.mock('@/lib/playable/task-route-handlers', () => ({ playableTaskHandlers: handlers }))

import { POST as create } from '@/app/api/playable-tasks/route'
import { POST as message } from '@/app/api/playable-tasks/[taskId]/messages/route'
import { POST as confirm } from '@/app/api/playable-tasks/[taskId]/confirm/route'
import { GET as events } from '@/app/api/playable-tasks/[taskId]/events/route'
import { GET as artifact } from '@/app/api/playable-tasks/[taskId]/artifact/route'

describe('playable route module delegation', () => {
  it('delegates all five route modules to the shared handlers', async () => {
    const request = new NextRequest('https://example.com')
    const context = { params: Promise.resolve({ taskId: 'task-1' }) }

    await create(request)
    await message(request, context)
    await confirm(request, context)
    await events(request, context)
    await artifact(request, context)

    expect(handlers.create).toHaveBeenCalledWith(request)
    expect(handlers.message).toHaveBeenCalledWith(request, context)
    expect(handlers.confirm).toHaveBeenCalledWith(request, context)
    expect(handlers.events).toHaveBeenCalledWith(request, context)
    expect(handlers.artifact).toHaveBeenCalledWith(request, context)
  })
})
