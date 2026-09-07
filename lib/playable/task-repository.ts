import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { playableTaskAssets, playableTaskEvents, taskMessages, tasks } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import {
  confirmationProposalSchema,
  playableTaskPhaseSchema,
  type ConfirmationProposal,
  type PlayableTaskPhase,
} from './schemas'
import type { PlayableEventRecord, PlayableTaskRecord, PlayableTaskRepository } from './task-api'
import type { PlayableAsset } from './task-assets'

function toTask(row: typeof tasks.$inferSelect): PlayableTaskRecord {
  return {
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    phase: playableTaskPhaseSchema.parse(row.phase),
    confirmation: row.confirmation ? confirmationProposalSchema.parse(row.confirmation) : null,
    latestArtifactKey: row.latestArtifactKey,
    latestValidation: row.latestValidation,
    title: row.title,
    createdAt: row.createdAt,
  }
}

export class DatabasePlayableTaskRepository implements PlayableTaskRepository {
  async createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord> {
    const [task] = await db
      .insert(tasks)
      .values({
        id: input.id,
        userId: input.userId,
        prompt: input.prompt,
        selectedAgent: 'codex',
        status: 'pending',
        phase: 'draft',
        progress: 0,
        logs: [],
      })
      .returning()
    return toTask(task)
  }

  async findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .limit(1)
    return task ? toTask(task) : undefined
  }

  async listOwnedTasks(userId: string): Promise<PlayableTaskRecord[]> {
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), isNull(tasks.repoUrl)))
      .orderBy(asc(tasks.createdAt))
    return rows.map(toTask).reverse()
  }

  async appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void> {
    await db.insert(taskMessages).values({ id: generateId(), taskId, role, content })
  }

  async setAwaitingConfirmation(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'awaiting_confirmation', updatedAt: new Date() })
      .where(
        and(eq(tasks.id, taskId), eq(tasks.userId, userId), inArray(tasks.phase, ['draft', 'awaiting_confirmation'])),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
  ): Promise<PlayableTaskRecord | undefined> {
    const [task] = await db
      .update(tasks)
      .set({
        phase: 'building',
        playableMode: confirmation.mode,
        confirmation,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), eq(tasks.phase, 'awaiting_confirmation')))
      .returning()
    return task ? toTask(task) : undefined
  }

  async compareAndSetPhase(taskId: string, expected: PlayableTaskPhase, next: PlayableTaskPhase): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: next, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.phase, expected)))
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async publishArtifact(
    taskId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({
        phase: 'ready',
        latestArtifactKey: artifactKey,
        latestValidation: validation,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.phase, expectedPhase)))
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async markFailed(taskId: string): Promise<void> {
    await db
      .update(tasks)
      .set({ phase: 'failed', updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), inArray(tasks.phase, ['building', 'validating'])))
  }

  async appendEvent(event: { taskId: string; type: string; phase?: string; message?: string }): Promise<void> {
    await db.insert(playableTaskEvents).values({
      id: generateId(),
      taskId: event.taskId,
      type: event.type,
      phase: event.phase,
      message: event.message,
    })
  }

  async listEvents(taskId: string): Promise<PlayableEventRecord[]> {
    const events = await db
      .select()
      .from(playableTaskEvents)
      .where(eq(playableTaskEvents.taskId, taskId))
      .orderBy(asc(playableTaskEvents.createdAt))
    return events.map((event) => ({
      id: event.id,
      taskId: event.taskId,
      type: event.type,
      ...(event.phase ? { phase: event.phase } : {}),
      ...(event.message ? { message: event.message } : {}),
      createdAt: event.createdAt,
    }))
  }

  async saveAsset(asset: PlayableAsset): Promise<void> {
    await db.insert(playableTaskAssets).values(asset)
  }

  async listAssets(taskId: string, userId: string): Promise<PlayableAsset[]> {
    const rows = await db
      .select()
      .from(playableTaskAssets)
      .where(and(eq(playableTaskAssets.taskId, taskId), eq(playableTaskAssets.userId, userId)))
      .orderBy(asc(playableTaskAssets.createdAt))
    return rows as PlayableAsset[]
  }
}
