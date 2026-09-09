import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  playableTaskAssets,
  playableTaskBuilds,
  playableTaskEvents,
  playableVideoAnalyses,
  taskMessages,
  tasks,
} from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import {
  confirmationProposalSchema,
  gameplayBlueprintSchema,
  playableTaskPhaseSchema,
  requirementBriefSchema,
  videoAnalysisStatusSchema,
  type ConfirmationProposal,
  type PlayableTaskPhase,
  type RequirementBrief,
} from './schemas'
import type {
  PlayableBuildRecord,
  PlayableEventRecord,
  PlayableTaskMessageRecord,
  PlayableTaskRecord,
  PlayableTaskRepository,
  PlayableVideoAnalysisRecord,
} from './task-api'
import type { PlayableAsset } from './task-assets'
import { createRequirementBrief } from './requirement-tools'

function toTask(row: typeof tasks.$inferSelect): PlayableTaskRecord {
  return {
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    phase: playableTaskPhaseSchema.parse(row.phase),
    requirementBrief: row.requirementBrief ? requirementBriefSchema.parse(row.requirementBrief) : null,
    confirmation: row.confirmation ? confirmationProposalSchema.parse(row.confirmation) : null,
    latestArtifactKey: row.latestArtifactKey,
    latestValidation: row.latestValidation,
    title: row.title,
    createdAt: row.createdAt,
  }
}

function toBuild(row: typeof playableTaskBuilds.$inferSelect): PlayableBuildRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status,
    confirmation: confirmationProposalSchema.parse(row.confirmation),
    artifactKey: row.artifactKey,
    validation: row.validation,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }
}

function toVideoAnalysis(row: typeof playableVideoAnalyses.$inferSelect): PlayableVideoAnalysisRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    assetId: row.assetId,
    status: videoAnalysisStatusSchema.parse(row.status),
    pipelineVersion: row.pipelineVersion,
    model: row.model,
    blueprint: row.blueprint ? gameplayBlueprintSchema.parse(row.blueprint) : null,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
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
        requirementBrief: createRequirementBrief(),
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

  async listMessages(taskId: string): Promise<PlayableTaskMessageRecord[]> {
    return db.select().from(taskMessages).where(eq(taskMessages.taskId, taskId)).orderBy(asc(taskMessages.createdAt))
  }

  async updateRequirementBrief(taskId: string, userId: string, brief: RequirementBrief): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ requirementBrief: requirementBriefSchema.parse(brief), updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['draft', 'awaiting_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async setDraft(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'draft', updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['draft', 'awaiting_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'awaiting_confirmation', confirmation, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['draft', 'awaiting_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    buildId: string,
  ): Promise<PlayableTaskRecord | undefined> {
    return db.transaction(async (transaction) => {
      const [task] = await transaction
        .update(tasks)
        .set({
          phase: 'building',
          playableMode: confirmation.mode,
          confirmation,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.userId, userId),
            inArray(tasks.phase, ['awaiting_confirmation', 'failed']),
          ),
        )
        .returning()
      if (!task) return undefined
      await transaction.insert(playableTaskBuilds).values({
        id: buildId,
        taskId,
        status: 'building',
        confirmation: confirmationProposalSchema.parse(confirmation),
      })
      return toTask(task)
    })
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
    buildId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean> {
    return db.transaction(async (transaction) => {
      const completedAt = new Date()
      const updatedTasks = await transaction
        .update(tasks)
        .set({
          phase: 'ready',
          latestArtifactKey: artifactKey,
          latestValidation: validation,
          completedAt,
          updatedAt: completedAt,
        })
        .where(and(eq(tasks.id, taskId), eq(tasks.phase, expectedPhase)))
        .returning({ id: tasks.id })
      if (updatedTasks.length !== 1) return false
      const updatedBuilds = await transaction
        .update(playableTaskBuilds)
        .set({ status: 'succeeded', artifactKey, validation, completedAt })
        .where(
          and(
            eq(playableTaskBuilds.id, buildId),
            eq(playableTaskBuilds.taskId, taskId),
            eq(playableTaskBuilds.status, 'building'),
          ),
        )
        .returning({ id: playableTaskBuilds.id })
      if (updatedBuilds.length !== 1) throw new Error('Build record transition failed')
      return true
    })
  }

  async acceptArtifact(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'ready', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), eq(tasks.phase, 'reviewing')))
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async requestRevision(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'awaiting_confirmation', completedAt: null, updatedAt: new Date() })
      .where(
        and(eq(tasks.id, taskId), eq(tasks.userId, userId), inArray(tasks.phase, ['reviewing', 'ready', 'failed'])),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async markFailed(taskId: string, buildId: string): Promise<void> {
    await db.transaction(async (transaction) => {
      const completedAt = new Date()
      await transaction
        .update(tasks)
        .set({ phase: 'failed', updatedAt: completedAt })
        .where(and(eq(tasks.id, taskId), inArray(tasks.phase, ['building', 'validating'])))
      await transaction
        .update(playableTaskBuilds)
        .set({ status: 'failed', completedAt })
        .where(
          and(
            eq(playableTaskBuilds.id, buildId),
            eq(playableTaskBuilds.taskId, taskId),
            eq(playableTaskBuilds.status, 'building'),
          ),
        )
    })
  }

  async listBuilds(taskId: string): Promise<PlayableBuildRecord[]> {
    const rows = await db
      .select()
      .from(playableTaskBuilds)
      .where(eq(playableTaskBuilds.taskId, taskId))
      .orderBy(asc(playableTaskBuilds.createdAt))
    return rows.map(toBuild)
  }

  async findBuild(taskId: string, buildId: string): Promise<PlayableBuildRecord | undefined> {
    const [row] = await db
      .select()
      .from(playableTaskBuilds)
      .where(and(eq(playableTaskBuilds.taskId, taskId), eq(playableTaskBuilds.id, buildId)))
      .limit(1)
    return row ? toBuild(row) : undefined
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

  async findOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined> {
    const [asset] = await db
      .select()
      .from(playableTaskAssets)
      .where(
        and(
          eq(playableTaskAssets.id, assetId),
          eq(playableTaskAssets.taskId, taskId),
          eq(playableTaskAssets.userId, userId),
        ),
      )
      .limit(1)
    return asset as PlayableAsset | undefined
  }

  async deleteOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined> {
    const [asset] = await db
      .delete(playableTaskAssets)
      .where(
        and(
          eq(playableTaskAssets.id, assetId),
          eq(playableTaskAssets.taskId, taskId),
          eq(playableTaskAssets.userId, userId),
        ),
      )
      .returning()
    return asset as PlayableAsset | undefined
  }

  async createVideoAnalysis(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
  }): Promise<PlayableVideoAnalysisRecord> {
    const [analysis] = await db.insert(playableVideoAnalyses).values(input).returning()
    return toVideoAnalysis(analysis)
  }

  async findLatestVideoAnalysis(taskId: string): Promise<PlayableVideoAnalysisRecord | undefined> {
    const [analysis] = await db
      .select()
      .from(playableVideoAnalyses)
      .where(eq(playableVideoAnalyses.taskId, taskId))
      .orderBy(desc(playableVideoAnalyses.createdAt))
      .limit(1)
    return analysis ? toVideoAnalysis(analysis) : undefined
  }

  async updateVideoAnalysisStatus(id: string, status: PlayableVideoAnalysisRecord['status']): Promise<void> {
    await db.update(playableVideoAnalyses).set({ status }).where(eq(playableVideoAnalyses.id, id))
  }

  async completeVideoAnalysis(id: string, blueprint: PlayableVideoAnalysisRecord['blueprint']): Promise<void> {
    if (!blueprint) throw new Error('Gameplay blueprint is required')
    await db
      .update(playableVideoAnalyses)
      .set({ status: 'succeeded', blueprint: gameplayBlueprintSchema.parse(blueprint), completedAt: new Date() })
      .where(eq(playableVideoAnalyses.id, id))
  }

  async failVideoAnalysis(id: string, errorCode: string): Promise<void> {
    await db
      .update(playableVideoAnalyses)
      .set({ status: 'failed', errorCode, completedAt: new Date() })
      .where(eq(playableVideoAnalyses.id, id))
  }
}
