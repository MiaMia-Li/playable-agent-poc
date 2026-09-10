import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  playableTaskAssets,
  playableTaskBuilds,
  playableTaskEvents,
  playableReferenceSelections,
  playableResearchCandidates,
  playableResearchRuns,
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
  revisionProposalSchema,
  videoAnalysisStatusSchema,
  type ConfirmationProposal,
  type PlayableTaskPhase,
  type RequirementBrief,
  type RevisionProposal,
} from './schemas'
import type {
  PlayableBuildRecord,
  PlayableEventRecord,
  PlayableTaskMessageRecord,
  PlayableTaskRecord,
  PlayableTaskRepository,
  PlayableResearchRunRecord,
  PlayableReferenceSelectionRecord,
  PlayableVideoAnalysisRecord,
} from './task-api'
import type { PlayableAsset } from './task-assets'
import { createRequirementBrief } from './requirement-tools'
import {
  marketResearchCandidateSchema,
  marketResearchIndustrySummarySchema,
  marketResearchReportSchema,
  referenceSelectionInputSchema,
  researchRunStatusSchema,
  resolvedReferenceSelectionSchema,
  searchBriefSchema,
  type MarketResearchReport,
  type ReferenceSelectionInput,
  type ResearchRunStatus,
  type SearchBrief,
} from './research/schemas'

function toTask(row: typeof tasks.$inferSelect): PlayableTaskRecord {
  return {
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    phase: playableTaskPhaseSchema.parse(row.phase),
    requirementBrief: row.requirementBrief ? requirementBriefSchema.parse(row.requirementBrief) : null,
    confirmation: row.confirmation ? confirmationProposalSchema.parse(row.confirmation) : null,
    pendingRevision: row.pendingRevision ? revisionProposalSchema.parse(row.pendingRevision) : null,
    latestArtifactKey: row.latestArtifactKey,
    latestValidation: row.latestValidation,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toBuild(row: typeof playableTaskBuilds.$inferSelect): PlayableBuildRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status,
    confirmation: confirmationProposalSchema.parse(row.confirmation),
    revision: row.revision ? revisionProposalSchema.parse(row.revision) : null,
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

function toResearchRun(row: typeof playableResearchRuns.$inferSelect): PlayableResearchRunRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    status: researchRunStatusSchema.parse(row.status),
    trigger: row.trigger,
    searchBrief: searchBriefSchema.parse(row.searchBrief),
    cacheKey: row.cacheKey,
    strategyVersion: row.strategyVersion,
    sourceIds: row.sourceIds,
    industrySummary: row.industrySummary ? marketResearchIndustrySummarySchema.parse(row.industrySummary) : null,
    warnings: row.warnings ?? [],
    cachedFromRunId: row.cachedFromRunId,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }
}

function toReferenceSelection(row: typeof playableReferenceSelections.$inferSelect): PlayableReferenceSelectionRecord {
  return {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    userId: row.userId,
    selection: referenceSelectionInputSchema.parse(row.selection),
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
        requirementBrief: createRequirementBrief(),
        pendingRevision: null,
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

  async renameOwnedTask(taskId: string, userId: string, title: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ title })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async deleteOwnedTask(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id })
    return updated.length === 1
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
          inArray(tasks.phase, ['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async setDraft(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'draft', pendingRevision: null, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'awaiting_confirmation', confirmation, pendingRevision: null, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async setAwaitingRevision(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    revision: RevisionProposal,
  ): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({
        phase: 'awaiting_revision_confirmation',
        confirmation,
        pendingRevision: revisionProposalSchema.parse(revision),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['awaiting_revision_confirmation', 'ready', 'failed']),
        ),
      )
      .returning({ id: tasks.id })
    return updated.length === 1
  }

  async clearPendingRevision(taskId: string, userId: string): Promise<boolean> {
    const updated = await db
      .update(tasks)
      .set({ phase: 'ready', pendingRevision: null, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          inArray(tasks.phase, ['awaiting_revision_confirmation', 'ready', 'failed']),
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
    revision?: RevisionProposal,
  ): Promise<PlayableTaskRecord | undefined> {
    return db.transaction(async (transaction) => {
      const [task] = await transaction
        .update(tasks)
        .set({
          phase: 'building',
          playableMode: confirmation.mode,
          confirmation,
          pendingRevision: revision ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.userId, userId),
            inArray(
              tasks.phase,
              revision ? ['awaiting_revision_confirmation', 'failed'] : ['awaiting_confirmation', 'failed'],
            ),
          ),
        )
        .returning()
      if (!task) return undefined
      await transaction.insert(playableTaskBuilds).values({
        id: buildId,
        taskId,
        status: 'building',
        confirmation: confirmationProposalSchema.parse(confirmation),
        revision: revision ? revisionProposalSchema.parse(revision) : null,
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
          pendingRevision: null,
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

  async claimVideoAnalysis(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
  }): Promise<{ analysis: PlayableVideoAnalysisRecord; claimed: boolean }> {
    const [inserted] = await db
      .insert(playableVideoAnalyses)
      .values(input)
      .onConflictDoNothing({
        target: [playableVideoAnalyses.assetId, playableVideoAnalyses.pipelineVersion, playableVideoAnalyses.model],
      })
      .returning()
    if (inserted) return { analysis: toVideoAnalysis(inserted), claimed: true }
    const [reclaimed] = await db
      .update(playableVideoAnalyses)
      .set({
        status: 'pending',
        blueprint: null,
        errorCode: null,
        completedAt: null,
        createdAt: new Date(),
      })
      .where(
        and(
          eq(playableVideoAnalyses.assetId, input.assetId),
          eq(playableVideoAnalyses.pipelineVersion, input.pipelineVersion),
          eq(playableVideoAnalyses.model, input.model),
          eq(playableVideoAnalyses.status, 'failed'),
        ),
      )
      .returning()
    if (reclaimed) return { analysis: toVideoAnalysis(reclaimed), claimed: true }
    const [existing] = await db
      .select()
      .from(playableVideoAnalyses)
      .where(
        and(
          eq(playableVideoAnalyses.assetId, input.assetId),
          eq(playableVideoAnalyses.pipelineVersion, input.pipelineVersion),
          eq(playableVideoAnalyses.model, input.model),
        ),
      )
      .limit(1)
    if (!existing) throw new Error('Video analysis claim failed')
    return { analysis: toVideoAnalysis(existing), claimed: false }
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

  async createResearchRun(input: {
    id: string
    taskId: string
    userId: string
    brief: SearchBrief
    cacheKey: string
    strategyVersion: string
    sourceIds: string[]
  }): Promise<PlayableResearchRunRecord> {
    const brief = searchBriefSchema.parse(input.brief)
    const [row] = await db
      .insert(playableResearchRuns)
      .values({
        id: input.id,
        taskId: input.taskId,
        userId: input.userId,
        status: 'confirmed',
        trigger: brief.trigger,
        searchBrief: brief,
        cacheKey: input.cacheKey,
        strategyVersion: input.strategyVersion,
        sourceIds: input.sourceIds,
      })
      .returning()
    return toResearchRun(row)
  }

  async updateResearchRunStatus(id: string, taskId: string, status: ResearchRunStatus): Promise<boolean> {
    const updated = await db
      .update(playableResearchRuns)
      .set({ status: researchRunStatusSchema.parse(status) })
      .where(and(eq(playableResearchRuns.id, id), eq(playableResearchRuns.taskId, taskId)))
      .returning({ id: playableResearchRuns.id })
    return updated.length === 1
  }

  async completeResearchRun(
    id: string,
    taskId: string,
    value: MarketResearchReport,
    cachedFromRunId: string | null = null,
  ): Promise<MarketResearchReport> {
    const report = marketResearchReportSchema.parse(value)
    return db.transaction(async (transaction) => {
      const completedAt = new Date()
      const candidates = report.candidates.map((candidate, position) => {
        const candidateWithId = marketResearchCandidateSchema.parse({ ...candidate, id: generateId() })
        return {
          row: {
            id: candidateWithId.id,
            runId: id,
            taskId,
            position,
            candidate: candidateWithId,
          },
          candidate: candidateWithId,
        }
      })
      const updated = await transaction
        .update(playableResearchRuns)
        .set({
          status: 'completed',
          sourceIds: report.sourceCoverage.sourceIds,
          industrySummary: report.industrySummary,
          warnings: report.warnings,
          cachedFromRunId,
          errorCode: null,
          completedAt,
        })
        .where(and(eq(playableResearchRuns.id, id), eq(playableResearchRuns.taskId, taskId)))
        .returning({ id: playableResearchRuns.id })
      if (updated.length !== 1) throw new Error('Research run transition failed')
      await transaction.insert(playableResearchCandidates).values(candidates.map(({ row }) => row))
      return marketResearchReportSchema.parse({
        ...report,
        runId: id,
        generatedAt: completedAt.toISOString(),
        candidates: candidates.map(({ candidate }) => candidate),
      })
    })
  }

  async failResearchRun(id: string, taskId: string, status: 'failed' | 'cancelled', errorCode: string): Promise<void> {
    await db
      .update(playableResearchRuns)
      .set({ status, errorCode, completedAt: new Date() })
      .where(and(eq(playableResearchRuns.id, id), eq(playableResearchRuns.taskId, taskId)))
  }

  async findResearchReport(taskId: string, userId: string, runId: string): Promise<MarketResearchReport | undefined> {
    const [row] = await db
      .select()
      .from(playableResearchRuns)
      .where(
        and(
          eq(playableResearchRuns.id, runId),
          eq(playableResearchRuns.taskId, taskId),
          eq(playableResearchRuns.userId, userId),
          eq(playableResearchRuns.status, 'completed'),
        ),
      )
      .limit(1)
    if (!row || !row.industrySummary || !row.completedAt) return undefined
    const candidates = await db
      .select()
      .from(playableResearchCandidates)
      .where(and(eq(playableResearchCandidates.runId, runId), eq(playableResearchCandidates.taskId, taskId)))
      .orderBy(asc(playableResearchCandidates.position))
    return marketResearchReportSchema.parse({
      version: 1,
      runId: row.id,
      brief: row.searchBrief,
      strategyVersion: row.strategyVersion,
      generatedAt: row.completedAt.toISOString(),
      industrySummary: row.industrySummary,
      candidates: candidates.map(({ candidate }) => candidate),
      sourceCoverage: { sourceIds: row.sourceIds, failedSourceIds: [] },
      warnings: row.warnings ?? [],
    })
  }

  async findReusableResearchReport(
    userId: string,
    cacheKey: string,
    strategyVersion: string,
    notBefore: Date,
  ): Promise<MarketResearchReport | undefined> {
    const [row] = await db
      .select()
      .from(playableResearchRuns)
      .where(
        and(
          eq(playableResearchRuns.userId, userId),
          eq(playableResearchRuns.cacheKey, cacheKey),
          eq(playableResearchRuns.strategyVersion, strategyVersion),
          eq(playableResearchRuns.status, 'completed'),
          gte(playableResearchRuns.completedAt, notBefore),
        ),
      )
      .orderBy(desc(playableResearchRuns.completedAt))
      .limit(1)
    return row ? this.findResearchReport(row.taskId, userId, row.id) : undefined
  }

  async saveReferenceSelection(input: {
    id: string
    taskId: string
    userId: string
    selection: ReferenceSelectionInput
  }) {
    const selection = referenceSelectionInputSchema.parse(input.selection)
    const report = await this.findResearchReport(input.taskId, input.userId, selection.runId)
    if (!report) return undefined
    const candidates = new Map(report.candidates.map((candidate) => [candidate.id, candidate]))
    const primaryCandidate = selection.primaryCandidateId ? candidates.get(selection.primaryCandidateId) : null
    if (selection.primaryCandidateId && !primaryCandidate) return undefined
    const selectedHighlights = selection.selectedHighlights.flatMap((highlight) => {
      const candidate = candidates.get(highlight.candidateId)
      if (!candidate || !candidate.borrowableHighlights.includes(highlight.value)) return []
      return [{ candidate, value: highlight.value }]
    })
    if (selectedHighlights.length !== selection.selectedHighlights.length) return undefined
    const [saved] = await db
      .insert(playableReferenceSelections)
      .values({
        id: input.id,
        runId: selection.runId,
        taskId: input.taskId,
        userId: input.userId,
        selection,
      })
      .onConflictDoNothing({ target: playableReferenceSelections.runId })
      .returning()
    if (!saved) return undefined
    return resolvedReferenceSelectionSchema.parse({
      runId: selection.runId,
      industrySummary: report.industrySummary,
      primaryCandidate,
      selectedHighlights,
      customRequirements: selection.customRequirements,
      exclusions: selection.exclusions,
    })
  }

  async listReferenceSelections(taskId: string, userId: string): Promise<PlayableReferenceSelectionRecord[]> {
    const rows = await db
      .select()
      .from(playableReferenceSelections)
      .where(and(eq(playableReferenceSelections.taskId, taskId), eq(playableReferenceSelections.userId, userId)))
      .orderBy(asc(playableReferenceSelections.createdAt))
    return rows.map(toReferenceSelection)
  }
}
