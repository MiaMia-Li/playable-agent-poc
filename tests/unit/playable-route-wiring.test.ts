import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { createValidationReport } from '@/lib/playable/production-contract'

const infrastructure = vi.hoisted(() => {
  const scheduled: Array<() => Promise<void>> = []
  return {
    scheduled,
    after: vi.fn((work: () => Promise<void>) => scheduled.push(work)),
    authenticatePublicPlayable: vi.fn(),
    readSharedPlayableAIKey: vi.fn(),
    generateId: vi.fn(),
    repository: {
      createTask: vi.fn(),
      findOwnedTask: vi.fn(),
      appendMessage: vi.fn(),
      setAwaitingConfirmation: vi.fn(),
      claimBuild: vi.fn(),
      compareAndSetPhase: vi.fn(),
      publishArtifact: vi.fn(),
      markFailed: vi.fn(),
      appendEvent: vi.fn(),
      listEvents: vi.fn(),
      listOwnedTasks: vi.fn(),
      saveAsset: vi.fn(),
      listAssets: vi.fn(),
      findLatestVideoAnalysis: vi.fn(),
    },
    agent: {
      proposeConfirmation: vi.fn(),
      build: vi.fn(),
      cancel: vi.fn(),
    },
    artifactStore: {
      put: vi.fn(),
      get: vi.fn(),
    },
  }
})

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: infrastructure.after,
}))
vi.mock('@/lib/playable/public-access', () => ({
  authenticatePublicPlayable: infrastructure.authenticatePublicPlayable,
}))
vi.mock('@/lib/playable/shared-ai-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/playable/shared-ai-key')>()),
  readSharedPlayableAIKey: infrastructure.readSharedPlayableAIKey,
}))
vi.mock('@/lib/utils/id', () => ({ generateId: infrastructure.generateId }))
vi.mock('@/lib/playable/task-repository', () => ({
  DatabasePlayableTaskRepository: class {
    constructor() {
      return infrastructure.repository
    }
  },
}))
vi.mock('@/lib/playable/codex-playable-agent', () => ({
  CodexPlayableAgent: class {
    constructor() {
      return infrastructure.agent
    }
  },
}))
vi.mock('@/lib/playable/artifact-store', () => ({
  PrivateVercelArtifactStore: class {
    constructor() {
      return infrastructure.artifactStore
    }
  },
}))

import { POST as create } from '@/app/api/playable-tasks/route'
import { POST as confirm } from '@/app/api/playable-tasks/[taskId]/confirm/route'

const confirmation: ConfirmationProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] },
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

describe('real playable task route wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    infrastructure.scheduled.length = 0
    infrastructure.authenticatePublicPlayable.mockResolvedValue('public-playable-poc-user')
    infrastructure.readSharedPlayableAIKey.mockResolvedValue('sk-shared-key')
    infrastructure.generateId.mockReturnValue('generated-id')
    infrastructure.repository.appendEvent.mockResolvedValue(undefined)
    infrastructure.repository.compareAndSetPhase.mockResolvedValue(true)
    infrastructure.repository.publishArtifact.mockResolvedValue(true)
    infrastructure.repository.markFailed.mockResolvedValue(undefined)
    infrastructure.repository.listAssets.mockResolvedValue([])
    infrastructure.repository.findLatestVideoAnalysis.mockResolvedValue(undefined)
    infrastructure.agent.build.mockResolvedValue({
      html: '<script>window.__PLAYABLE__={}</script>',
      validation: createValidationReport({ bytes: 42, offlineResources: true, responsiveViewport: true }),
    })
    infrastructure.artifactStore.put.mockResolvedValue(undefined)
  })

  it('creates tasks through the public POC identity without an OAuth session', async () => {
    infrastructure.repository.createTask.mockResolvedValueOnce({
      id: 'generated-id',
      userId: 'public-playable-poc-user',
      prompt: 'Build a game',
      phase: 'draft',
      confirmation: null,
      latestArtifactKey: null,
    })
    const request = new NextRequest('https://example.com/api/playable-tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Build a game' }),
    })

    const response = await create(request)

    expect(response.status).toBe(201)
    expect(infrastructure.authenticatePublicPlayable).toHaveBeenCalledWith(request)
    expect(infrastructure.repository.createTask).toHaveBeenCalledWith({
      id: 'generated-id',
      userId: 'public-playable-poc-user',
      prompt: 'Build a game',
    })
  })

  it('wires confirmation through key, repository, after, agent, and private Blob boundaries', async () => {
    const task = {
      id: 'task-1',
      userId: 'public-playable-poc-user',
      prompt: 'Build a game',
      phase: 'awaiting_confirmation',
      confirmation,
      latestArtifactKey: null,
    }
    infrastructure.repository.findOwnedTask.mockResolvedValueOnce(task)
    infrastructure.repository.claimBuild.mockResolvedValueOnce({ ...task, phase: 'building' })
    infrastructure.generateId.mockReturnValueOnce('build-1')
    const request = new NextRequest('https://example.com/api/playable-tasks/task-1/confirm', {
      method: 'POST',
      body: JSON.stringify({ confirmation }),
    })

    const response = await confirm(request, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(response.status).toBe(202)
    expect(infrastructure.readSharedPlayableAIKey).toHaveBeenCalledOnce()
    expect(infrastructure.after).toHaveBeenCalledOnce()

    await infrastructure.scheduled[0]()

    expect(infrastructure.agent.build).toHaveBeenCalledWith({
      taskId: 'task-1',
      apiKey: 'sk-shared-key',
      confirmation,
      assets: [],
    })
    expect(infrastructure.artifactStore.put).toHaveBeenCalledTimes(4)
    expect(infrastructure.repository.publishArtifact).toHaveBeenCalledWith(
      'task-1',
      'build-1',
      'validating',
      'users/public-playable-poc-user/tasks/task-1/build-1/playable.html',
      expect.objectContaining({ passed: true, behavior: 'passed', bytes: 42 }),
    )
  })
})
