import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const handlers = vi.hoisted(() => ({
  list: vi.fn(async () => new Response(null)),
  create: vi.fn(async () => new Response(null, { status: 201 })),
  rename: vi.fn(async () => new Response(null)),
  remove: vi.fn(async () => new Response(null, { status: 204 })),
  message: vi.fn(async () => new Response(null)),
  confirm: vi.fn(async () => new Response(null, { status: 202 })),
  review: vi.fn(async () => new Response(null)),
  events: vi.fn(async () => new Response(null)),
  versions: vi.fn(async () => new Response(null)),
  artifact: vi.fn(async () => new Response(null)),
  asset: vi.fn(async () => new Response(null, { status: 201 })),
}))

vi.mock('@/lib/playable/task-route-handlers', () => ({
  playableTaskHandlers: handlers,
  playableAssetHandler: handlers.asset,
}))

import { GET as list, POST as create } from '@/app/api/playable-tasks/route'
import { DELETE as remove, PATCH as rename } from '@/app/api/playable-tasks/[taskId]/route'
import { POST as message } from '@/app/api/playable-tasks/[taskId]/messages/route'
import { POST as confirm } from '@/app/api/playable-tasks/[taskId]/confirm/route'
import { POST as review } from '@/app/api/playable-tasks/[taskId]/review/route'
import { GET as events } from '@/app/api/playable-tasks/[taskId]/events/route'
import { GET as versions } from '@/app/api/playable-tasks/[taskId]/versions/route'
import { GET as artifact } from '@/app/api/playable-tasks/[taskId]/artifact/route'
import { POST as asset } from '@/app/api/playable-tasks/[taskId]/assets/route'

describe('playable route module delegation', () => {
  it('delegates all playable route modules to the shared handlers', async () => {
    const request = new NextRequest('https://example.com')
    const context = { params: Promise.resolve({ taskId: 'task-1' }) }

    await list(request)
    await create(request)
    await rename(request, context)
    await remove(request, context)
    await asset(request, context)
    await message(request, context)
    await confirm(request, context)
    await review(request, context)
    await events(request, context)
    await versions(request, context)
    await artifact(request, context)

    expect(handlers.list).toHaveBeenCalledWith(request)
    expect(handlers.create).toHaveBeenCalledWith(request)
    expect(handlers.rename).toHaveBeenCalledWith(request, context)
    expect(handlers.remove).toHaveBeenCalledWith(request, context)
    expect(handlers.asset).toHaveBeenCalledWith(request, context)
    expect(handlers.message).toHaveBeenCalledWith(request, context)
    expect(handlers.confirm).toHaveBeenCalledWith(request, context)
    expect(handlers.review).toHaveBeenCalledWith(request, context)
    expect(handlers.events).toHaveBeenCalledWith(request, context)
    expect(handlers.versions).toHaveBeenCalledWith(request, context)
    expect(handlers.artifact).toHaveBeenCalledWith(request, context)
  })
})
