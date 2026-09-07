import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createPlayableTaskHandlers,
  runConfirmedBuild,
  type BackgroundScheduler,
  type PlayableTaskRecord,
  type PlayableTaskRepository,
} from '@/lib/playable/task-api'
import { PrivateVercelArtifactStore, type ArtifactStore, type PrivateBlobClient } from '@/lib/playable/artifact-store'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import type { PlayableAgentAdapter } from '@/lib/playable/playable-agent-adapter'

const confirmation: ConfirmationProposal = {
  mode: 'center_collision',
  gameplay: 'Match identical tiles.',
  resources: {
    tileFaces: { status: '内置默认', treatment: 'Use bundled tile faces.' },
    backgroundBoard: { status: '内置默认', treatment: 'Use bundled board.' },
    animationEffects: { status: '内置默认', treatment: 'Use bundled effects.' },
    audio: { status: '内置默认', treatment: 'Use bundled audio.' },
    endCard: { status: '内置默认', treatment: 'Use bundled end card.' },
  },
  copy: { title: 'Match', cta: 'Play', disclaimer: '', locale: 'en' },
  storeUrl: 'https://example.com/app',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

type EventRecord = {
  id: string
  taskId: string
  type: string
  phase?: string
  message?: string
  createdAt: Date
  privateData?: unknown
}

function byteStream(value: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value)
      controller.close()
    },
  })
}

class MemoryRepository implements PlayableTaskRepository {
  tasks = new Map<string, PlayableTaskRecord>()
  messages: Array<{ taskId: string; role: 'user' | 'agent'; content: string }> = []
  events: EventRecord[] = []
  latestAssignments: string[] = []

  async createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord> {
    const task: PlayableTaskRecord = {
      id: input.id,
      userId: input.userId,
      prompt: input.prompt,
      phase: 'draft',
      confirmation: null,
      latestArtifactKey: null,
    }
    this.tasks.set(task.id, task)
    return task
  }

  async findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined> {
    const task = this.tasks.get(taskId)
    return task?.userId === userId ? task : undefined
  }

  async appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void> {
    this.messages.push({ taskId, role, content })
  }

  async setAwaitingConfirmation(taskId: string, userId: string): Promise<boolean> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || !['draft', 'awaiting_confirmation'].includes(task.phase)) return false
    task.phase = 'awaiting_confirmation'
    return true
  }

  async claimBuild(
    taskId: string,
    userId: string,
    value: ConfirmationProposal,
  ): Promise<PlayableTaskRecord | undefined> {
    const task = await this.findOwnedTask(taskId, userId)
    if (!task || task.phase !== 'awaiting_confirmation') return
    task.phase = 'building'
    task.confirmation = value
    return { ...task }
  }

  async compareAndSetPhase(
    taskId: string,
    expected: PlayableTaskRecord['phase'],
    next: PlayableTaskRecord['phase'],
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expected) return false
    task.phase = next
    return true
  }

  async publishArtifact(
    taskId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.phase !== expectedPhase) return false
    task.phase = 'ready'
    task.latestArtifactKey = artifactKey
    task.latestValidation = validation
    this.latestAssignments.push(artifactKey)
    return true
  }

  async markFailed(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (task && ['building', 'validating'].includes(task.phase)) task.phase = 'failed'
  }

  async appendEvent(event: Omit<EventRecord, 'id' | 'createdAt'>): Promise<void> {
    this.events.push({ ...event, id: `event-${this.events.length + 1}`, createdAt: new Date(0) })
  }

  async listEvents(taskId: string): Promise<EventRecord[]> {
    return this.events.filter((event) => event.taskId === taskId)
  }
}

function createHarness() {
  const repository = new MemoryRepository()
  repository.tasks.set('owned', {
    id: 'owned',
    userId: 'user-1',
    prompt: 'Build a game',
    phase: 'draft',
    confirmation: null,
    latestArtifactKey: null,
  })
  repository.tasks.set('foreign', {
    id: 'foreign',
    userId: 'user-2',
    prompt: 'Secret task',
    phase: 'ready',
    confirmation,
    latestArtifactKey: 'users/user-2/tasks/foreign/build/playable.html',
  })

  const scheduled: Array<() => Promise<void>> = []
  const scheduler: BackgroundScheduler = (work) => scheduled.push(work)
  const agent: PlayableAgentAdapter = {
    proposeConfirmation: vi.fn(async () => confirmation),
    build: vi.fn(async () => ({
      html: '<!doctype html><script>window.__PLAYABLE__={}</script>',
      validation: { behavior: 'passed' as const, bytes: 57 },
    })),
    cancel: vi.fn(async () => undefined),
  }
  const artifacts = new Map<string, Uint8Array>()
  const artifactStore: ArtifactStore = {
    put: vi.fn(async (key, value) => {
      artifacts.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value)
    }),
    get: vi.fn(async (key) => {
      const value = artifacts.get(key)
      return value ? byteStream(value) : undefined
    }),
  }
  let authenticatedUserId: string | undefined = 'user-1'
  const handlers = createPlayableTaskHandlers({
    authenticate: async () => authenticatedUserId,
    readApiKey: async () => 'sk-test-secret',
    repository,
    agent,
    artifactStore,
    schedule: scheduler,
    generateId: (() => {
      let id = 0
      return () => `random-${++id}`
    })(),
  })

  return {
    repository,
    scheduled,
    agent,
    artifactStore,
    artifacts,
    handlers,
    setAuthenticatedUser(value: string | undefined) {
      authenticatedUserId = value
    },
  }
}

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`https://app.example${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

describe('playable task API', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    harness = createHarness()
  })

  it('returns 401 from every route without authentication', async () => {
    harness.setAuthenticatedUser(undefined)
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const responses = await Promise.all([
      harness.handlers.create(request('/api/playable-tasks', 'POST', { prompt: 'game' })),
      harness.handlers.message(request('/api/playable-tasks/owned/messages', 'POST', { message: 'hello' }), context),
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
      harness.handlers.events(request('/api/playable-tasks/owned/events'), context),
      harness.handlers.artifact(request('/api/playable-tasks/owned/artifact?kind=playable'), context),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401])
  })

  it('creates an authenticated task in draft without returning private fields', async () => {
    const response = await harness.handlers.create(
      request('/api/playable-tasks', 'POST', { prompt: 'Build a mahjong game' }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ task: { id: 'random-1', phase: 'draft' } })
    expect(harness.repository.tasks.get('random-1')).toMatchObject({
      userId: 'user-1',
      prompt: 'Build a mahjong game',
      phase: 'draft',
    })
  })

  it('returns the same 404 for missing and cross-user resources', async () => {
    const missing = { params: Promise.resolve({ taskId: 'missing' }) }
    const foreign = { params: Promise.resolve({ taskId: 'foreign' }) }
    const calls = [
      () => harness.handlers.events(request('/api/playable-tasks/missing/events'), missing),
      () => harness.handlers.events(request('/api/playable-tasks/foreign/events'), foreign),
      () => harness.handlers.artifact(request('/api/playable-tasks/missing/artifact?kind=playable'), missing),
      () => harness.handlers.artifact(request('/api/playable-tasks/foreign/artifact?kind=playable'), foreign),
      () =>
        harness.handlers.message(
          request('/api/playable-tasks/foreign/messages', 'POST', { message: 'steal' }),
          foreign,
        ),
      () => harness.handlers.confirm(request('/api/playable-tasks/foreign/confirm', 'POST', { confirmation }), foreign),
    ]
    const responses = await Promise.all(calls.map((call) => call()))

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404])
    for (const response of responses) expect(await response.json()).toEqual({ error: 'Not found' })
    expect(JSON.stringify(responses)).not.toContain('user-2')
    expect(JSON.stringify(responses)).not.toContain('users/user-2')
  })

  it('appends chat messages and streams sanitized agent events', async () => {
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make it bright sk-leaked1234' }),
      context,
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(body).toContain('"type":"confirmation"')
    expect(body).toContain('"mode":"center_collision"')
    expect(body).not.toContain('sk-test-secret')
    expect(body).not.toContain('sk-leaked1234')
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
    expect(harness.repository.messages.map(({ role }) => role)).toEqual(['user', 'agent'])
    expect(JSON.stringify(harness.repository.messages)).not.toContain('sk-test-secret')
  })

  it('rejects an agent proposal that echoes the API key before storing it', async () => {
    vi.mocked(harness.agent.proposeConfirmation).mockResolvedValueOnce({
      ...confirmation,
      gameplay: 'Leaked sk-test-secret',
    })
    const response = await harness.handlers.message(
      request('/api/playable-tasks/owned/messages', 'POST', { message: 'Make a game' }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(await response.text()).toContain('"type":"error"')
    expect(harness.repository.messages).toHaveLength(1)
    expect(JSON.stringify(harness.repository.messages)).not.toContain('sk-test-secret')
    expect(harness.repository.tasks.get('owned')?.phase).toBe('draft')
  })

  it('rejects a build until a task is awaiting confirmation', async () => {
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(409)
    expect(harness.scheduled).toHaveLength(0)
    expect(harness.agent.build).not.toHaveBeenCalled()
  })

  it('validates confirmation before atomically claiming and scheduling one build', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const context = { params: Promise.resolve({ taskId: 'owned' }) }
    const [first, second] = await Promise.all([
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
      harness.handlers.confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), context),
    ])

    expect([first.status, second.status].sort()).toEqual([202, 409])
    expect(harness.scheduled).toHaveLength(1)
    expect(harness.agent.build).not.toHaveBeenCalled()
    expect(harness.repository.tasks.get('owned')?.phase).toBe('building')

    const invalid = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        confirmation: { ...confirmation, mode: 'custom' },
      }),
      context,
    )
    expect(invalid.status).toBe(400)
  })

  it('returns confirmation without waiting for background event or build work', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    vi.spyOn(harness.repository, 'appendEvent').mockImplementationOnce(() => new Promise(() => undefined))

    const outcome = await Promise.race([
      harness.handlers
        .confirm(request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }), {
          params: Promise.resolve({ taskId: 'owned' }),
        })
        .then((response) => response.status),
      new Promise<number>((resolve) => setTimeout(() => resolve(599), 25)),
    ])

    expect(outcome).toBe(202)
    expect(harness.scheduled).toHaveLength(1)
    expect(harness.agent.build).not.toHaveBeenCalled()
  })

  it('rejects confirmation containing the API key before the atomic database claim', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', {
        confirmation: { ...confirmation, gameplay: 'Leaked sk-test-secret' },
      }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(400)
    expect(harness.repository.tasks.get('owned')?.phase).toBe('awaiting_confirmation')
    expect(harness.repository.tasks.get('owned')?.confirmation).toBeNull()
    expect(harness.scheduled).toHaveLength(0)
  })

  it('publishes an artifact only after successful validation and storage', async () => {
    harness.repository.tasks.get('owned')!.phase = 'awaiting_confirmation'
    const response = await harness.handlers.confirm(
      request('/api/playable-tasks/owned/confirm', 'POST', { confirmation }),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(response.status).toBe(202)
    expect(harness.repository.tasks.get('owned')?.latestArtifactKey).toBeNull()
    await harness.scheduled[0]()

    const task = harness.repository.tasks.get('owned')
    expect(task?.phase).toBe('ready')
    expect(task?.latestArtifactKey).toMatch(/^users\/user-1\/tasks\/owned\/random-\d+\/playable\.html$/)
    expect([...harness.artifacts.keys()].sort()).toEqual([
      expect.stringMatching(/asset-manifest\.json$/),
      expect.stringMatching(/confirmed-config\.json$/),
      expect.stringMatching(/playable\.html$/),
      expect.stringMatching(/validation-report\.json$/),
    ])
    expect(harness.repository.latestAssignments).toHaveLength(1)
  })

  it('marks a failed build without replacing the last published artifact', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    task.latestArtifactKey = 'users/user-1/tasks/owned/old/playable.html'
    vi.mocked(harness.agent.build).mockRejectedValueOnce(new Error('provider secret sk-build-secret'))

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'new-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(task.latestArtifactKey).toBe('users/user-1/tasks/owned/old/playable.html')
    expect(harness.repository.latestAssignments).toHaveLength(0)
    expect(JSON.stringify(harness.repository.events)).not.toContain('provider secret')
    expect(JSON.stringify(harness.repository.events)).not.toContain('sk-build-secret')
  })

  it('rejects credential-bearing build output before writing any artifact', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'building'
    task.confirmation = confirmation
    vi.mocked(harness.agent.build).mockResolvedValueOnce({
      html: '<script>window.__PLAYABLE__="sk-test-secret"</script>',
      validation: { behavior: 'passed', bytes: 52 },
    })

    await runConfirmedBuild({
      task,
      apiKey: 'sk-test-secret',
      buildId: 'new-build',
      repository: harness.repository,
      agent: harness.agent,
      artifactStore: harness.artifactStore,
    })

    expect(task.phase).toBe('failed')
    expect(harness.artifactStore.put).not.toHaveBeenCalled()
    expect(JSON.stringify(harness.repository.events)).not.toContain('sk-test-secret')
  })

  it('returns only allowlisted and redacted event fields', async () => {
    harness.repository.events.push({
      id: 'event-private',
      taskId: 'owned',
      type: 'build_failed',
      phase: 'failed',
      message: 'Failed with sk-event-secret',
      privateData: { blobUrl: 'https://private.public.blob.vercel-storage.com/path' },
      createdAt: new Date(0),
    })
    const response = await harness.handlers.events(request('/api/playable-tasks/owned/events'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(200)
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('sk-event-secret')
    expect(serialized).not.toContain('blob.vercel-storage.com')
    expect(serialized).not.toContain('privateData')
    expect(serialized).not.toContain('"taskId"')
  })

  it('streams owned ready artifacts with strict iframe headers and no Blob URL', async () => {
    const task = harness.repository.tasks.get('owned')!
    task.phase = 'ready'
    task.latestArtifactKey = 'users/user-1/tasks/owned/build/playable.html'
    harness.artifacts.set(task.latestArtifactKey, new TextEncoder().encode('<html>safe</html>'))

    const inline = await harness.handlers.artifact(request('/api/playable-tasks/owned/artifact?kind=playable'), {
      params: Promise.resolve({ taskId: 'owned' }),
    })
    const download = await harness.handlers.artifact(
      request('/api/playable-tasks/owned/artifact?kind=playable&download=1'),
      { params: Promise.resolve({ taskId: 'owned' }) },
    )

    expect(inline.status).toBe(200)
    expect(await inline.text()).toBe('<html>safe</html>')
    expect(inline.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(inline.headers.get('content-disposition')).toBe('inline; filename="playable.html"')
    expect(inline.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'",
    )
    expect(inline.headers.get('x-content-type-options')).toBe('nosniff')
    expect(inline.headers.get('cache-control')).toBe('private, no-store')
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="playable.html"')
    expect(JSON.stringify([...inline.headers])).not.toContain('blob.vercel-storage.com')
  })
})

describe('PrivateVercelArtifactStore', () => {
  it('uses private Blob access and never returns provider URLs', async () => {
    const blobClient: PrivateBlobClient = {
      put: vi.fn(async () => ({
        url: 'https://private.public.blob.vercel-storage.com/secret',
        pathname: 'users/u/tasks/t/b/playable.html',
      })),
      get: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('artifact'))
            controller.close()
          },
        }),
      })),
    }
    const store = new PrivateVercelArtifactStore(blobClient)

    await expect(store.put('users/u/tasks/t/b/playable.html', 'artifact', 'text/html')).resolves.toBeUndefined()
    const stream = await store.get('users/u/tasks/t/b/playable.html')
    await expect(new Response(stream).text()).resolves.toBe('artifact')
    expect(blobClient.put).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html', 'artifact', {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'text/html',
    })
    expect(blobClient.get).toHaveBeenCalledWith('users/u/tasks/t/b/playable.html', { access: 'private' })
  })
})
