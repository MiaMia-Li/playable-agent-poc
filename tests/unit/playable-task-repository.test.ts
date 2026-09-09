import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import { playableTaskAssets, playableTaskBuilds, playableTaskEvents, playableVideoAnalyses } from '@/lib/db/schema'

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

const database = vi.hoisted(() => {
  const returning = vi.fn()
  const where = vi.fn((_condition: unknown) => ({ returning }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))
  const values = vi.fn()
  const insert = vi.fn(() => ({ values }))
  const transaction = vi.fn(async (operation: (client: { update: typeof update; insert: typeof insert }) => unknown) =>
    operation({ update, insert }),
  )
  return { update, set, where, returning, insert, values, transaction }
})

vi.mock('@/lib/db/client', () => ({
  db: { update: database.update, transaction: database.transaction },
}))

import { DatabasePlayableTaskRepository } from '@/lib/playable/task-repository'

describe('DatabasePlayableTaskRepository atomic transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists the proposal while moving to awaiting confirmation', async () => {
    database.returning.mockResolvedValueOnce([{ id: 'task-1' }])
    const repository = new DatabasePlayableTaskRepository()

    await expect(repository.setAwaitingConfirmation('task-1', 'user-1', confirmation)).resolves.toBe(true)

    expect(database.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'awaiting_confirmation',
        confirmation,
      }),
    )
  })

  it('claims a build only for the owner in awaiting_confirmation', async () => {
    database.returning.mockResolvedValueOnce([
      {
        id: 'task-1',
        userId: 'user-1',
        prompt: 'game',
        phase: 'building',
        confirmation,
        latestArtifactKey: null,
      },
    ])
    const repository = new DatabasePlayableTaskRepository()

    await expect(repository.claimBuild('task-1', 'user-1', confirmation, 'build-1')).resolves.toMatchObject({
      phase: 'building',
    })

    const query = new PgDialect().sqlToQuery(database.where.mock.calls[0][0] as SQL)
    expect(query.sql).toContain('"tasks"."id" = $')
    expect(query.sql).toContain('"tasks"."user_id" = $')
    expect(query.sql).toContain('"tasks"."phase" in ($')
    expect(query.params).toEqual(['task-1', 'user-1', 'awaiting_confirmation', 'failed'])
    expect(database.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'building',
        playableMode: confirmation.mode,
        confirmation,
      }),
    )
  })

  it('publishes with a validating compare-and-set instead of an unconditional update', async () => {
    database.returning.mockResolvedValueOnce([{ id: 'task-1' }]).mockResolvedValueOnce([{ id: 'build-1' }])
    const repository = new DatabasePlayableTaskRepository()

    await expect(
      repository.publishArtifact('task-1', 'build-1', 'validating', 'users/user-1/tasks/task-1/build/playable.html', {
        behavior: 'passed',
      }),
    ).resolves.toBe(true)

    const query = new PgDialect().sqlToQuery(database.where.mock.calls[0][0] as SQL)
    expect(query.sql).toContain('"tasks"."id" = $')
    expect(query.sql).toContain('"tasks"."phase" = $')
    expect(query.params).toEqual(['task-1', 'validating'])
    expect(database.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'ready',
        latestArtifactKey: 'users/user-1/tasks/task-1/build/playable.html',
      }),
    )
  })
})

describe('playable task event storage', () => {
  it('indexes task and creation time for ordered task event reads', () => {
    const index = getTableConfig(playableTaskEvents).indexes.find(
      (candidate) => candidate.config.name === 'playable_task_events_task_created_idx',
    )

    expect(index?.config.columns.map((column) => (column as { name?: string }).name)).toEqual(['task_id', 'created_at'])
  })
})

describe('playable task build storage', () => {
  it('indexes immutable build history by task and creation time', () => {
    const config = getTableConfig(playableTaskBuilds)
    const index = config.indexes.find((candidate) => candidate.config.name === 'playable_task_builds_task_created_idx')

    expect(index?.config.columns.map((column) => (column as { name?: string }).name)).toEqual(['task_id', 'created_at'])
    expect(config.columns.find((column) => column.name === 'artifact_key')?.isUnique).toBe(true)
  })
})

describe('playable task asset storage', () => {
  it('persists private storage metadata with task/owner foreign keys and a task-slot index', () => {
    const config = getTableConfig(playableTaskAssets)
    expect(config.foreignKeys).toHaveLength(2)
    const index = config.indexes.find((candidate) => candidate.config.name === 'playable_task_assets_task_slot_idx')
    expect(index?.config.columns.map((column) => (column as { name?: string }).name)).toEqual(['task_id', 'slot'])
    expect(config.columns.find((column) => column.name === 'storage_key')?.isUnique).toBe(true)
  })
})

describe('playable video analysis storage', () => {
  it('indexes analysis history by task and source video pipeline', () => {
    const config = getTableConfig(playableVideoAnalyses)
    expect(config.foreignKeys).toHaveLength(2)
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'playable_video_analyses_task_created_idx',
        'playable_video_analyses_asset_pipeline_idx',
      ]),
    )
  })
})
