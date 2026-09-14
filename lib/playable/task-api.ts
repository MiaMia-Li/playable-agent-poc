import { mergeReasoning } from './reasoning-history'
import { sanitizeBuildActivityDetail } from './build-activity-detail'
import { buildActivityLabels, type BuildActivityCallback } from './build-activity'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sourceTemplateIds } from './types'
import { bindSourceTemplate, selectedSourceTemplate } from './source-template'
import type { SourceTemplateId } from './types'
import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import {
  PlayableAgentError,
  type PlayableAgentAdapter,
  type PlayableBuildAsset,
  type PlayableValidationSummary,
} from './playable-agent-adapter'
import {
  confirmationProposalSchema,
  gameplayAnnotationsSchema,
  gameplayBlueprintSchema,
  playableAgentReplySchema,
  requirementBriefSchema,
  revisionProposalSchema,
  toGameplayBlueprintDocument,
  videoAnalysisStatusSchema,
  MAX_GAMEPLAY_ANNOTATIONS,
  type ConfirmationProposal,
  type GameplayAnnotation,
  type GameplayAnnotationDraft,
  type GameplayBlueprint,
  type GameplayBlueprintDocument,
  type PlayableAgentReply,
  type PlayableTaskPhase,
  type RequirementBrief,
  type RevisionPlan,
  type RevisionProposal,
  type VideoAnalysisStatus,
} from './schemas'
import { redactSecrets } from './redact'
import { safeAsset, type PlayableAsset } from './task-assets'
import { generatePlayableMediaAssets } from './media-generation'
import { createAssetSourceManifest, createProductionConfig } from './production-contract'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'
import { isPlayableResourceAssetSlot } from './asset-policy'
import { createRequirementBrief } from './requirement-tools'
import type { AppliedMediaResolution, VideoGameplayAnalyst } from './video-gameplay-analyst'
import { VIDEO_ANALYSIS_PIPELINE_VERSION } from './video-gameplay-analyst'
import { runIntentComparison, runVideoAnalysis, VIDEO_ANALYSIS_BUDGET_MS } from './video-analysis-service'
import { deriveGameplayIntent } from './gameplay-intent'
import { PlayableBuildExecutionError } from './sandbox-runner'
import {
  deliveryProfileIdFor,
  deliveryProfileSnapshot,
  getDeliveryProfile,
  isDeliveryProfileId,
} from './delivery-standards'
import {
  referenceImageAnalysisSchema,
  type ReferenceImageAnalyst,
  type ReferenceImageAnalysis,
} from './reference-image-analyst'
import type { RequirementAnalysisToolCall } from './playable-agent-adapter'
import type {
  MarketResearchIndustrySummary,
  MarketResearchReport,
  ReferenceSelectionInput,
  ResearchRunStatus,
  ResolvedReferenceSelection,
  SearchBrief,
} from './research/schemas'
import { referenceSelectionInputSchema } from './research/schemas'
import type { MarketResearchAgent, MarketResearchProgressStage } from './research/market-research-agent'
import {
  allowedResearchDomains,
  createResearchCacheKey,
  MARKET_RESEARCH_CACHE_TTL_MS,
  MARKET_RESEARCH_STRATEGY_VERSION,
} from './research/source-registry'

type RouteContext = { params: Promise<{ taskId: string }> }

const RUNNING_ANALYSIS_STATUSES: ReadonlySet<VideoAnalysisStatus> = new Set(['pending', 'preprocessing', 'analyzing'])

/**
 * How long an analysis may sit in a running state before it is presumed dead.
 * Sized well above the worst observed end-to-end time including retries, so a
 * slow run is never mistaken for an abandoned one.
 */
const STALE_ANALYSIS_MS = 15 * 60 * 1000

/**
 * An intent comparison runs in the background of the message route, which has
 * no raised `maxDuration`. It is text only and far quicker than a video run,
 * so it is cut off well inside the platform default.
 */
const INTENT_COMPARISON_BUDGET_MS = 240_000

/**
 * The analysis a task currently has for its active video, as three views that
 * used to be one. `latest` carries the status the user sees; `source` is the
 * newest succeeded attempt, which the blueprint is read from so a re-run or an
 * intent comparison never leaves the agent without one; `intentPending` says
 * the brief has moved on since `source` was compared against it.
 */
interface CurrentVideoAnalysis {
  latest: PlayableVideoAnalysisRecord
  source?: PlayableVideoAnalysisRecord
  intentPending: boolean
}

export interface PlayableTaskRecord {
  id: string
  userId: string
  prompt: string
  phase: PlayableTaskPhase
  activeReferenceVideoAssetId: string | null
  gameplayAnnotations: GameplayAnnotation[]
  requirementBrief: RequirementBrief | null
  confirmation: ConfirmationProposal | null
  pendingRevision?: RevisionProposal | null
  latestArtifactKey: string | null
  latestValidation?: unknown
  title?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export interface PlayableEventRecord {
  id: string
  taskId: string
  type: string
  phase?: string
  message?: string
  createdAt: Date
}

export interface PlayableTaskMessageRecord {
  id: string
  taskId: string
  role: 'user' | 'agent'
  content: string
  createdAt: Date
}

export interface PlayableVideoAnalysisRecord {
  id: string
  taskId: string
  assetId: string
  status: VideoAnalysisStatus
  pipelineVersion: string
  model: string
  attempt: number
  mediaResolution: AppliedMediaResolution | null
  /**
   * The intent this blueprint's divergence was computed against. Null for
   * rows written before it was recorded, which are treated as "unknown" and
   * so compared again once any intent exists.
   */
  intentText: string | null
  blueprint: GameplayBlueprint | null
  errorCode: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface PlayableResearchRunRecord {
  id: string
  taskId: string
  userId: string
  status: ResearchRunStatus
  trigger: SearchBrief['trigger']
  searchBrief: SearchBrief
  cacheKey: string
  strategyVersion: string
  sourceIds: string[]
  industrySummary: MarketResearchIndustrySummary | null
  warnings: string[]
  cachedFromRunId: string | null
  errorCode: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface PlayableReferenceSelectionRecord {
  id: string
  runId: string
  taskId: string
  userId: string
  selection: ReferenceSelectionInput
  createdAt: Date
}

export type PlayableBuildStatus = 'building' | 'failed' | 'succeeded'

export interface PlayableBuildRecord {
  id: string
  taskId: string
  status: PlayableBuildStatus
  confirmation: ConfirmationProposal
  revision?: RevisionProposal | null
  artifactKey: string | null
  validation?: unknown
  createdAt: Date
  completedAt?: Date | null
}

export interface PlayableTaskRepository {
  createTask(input: {
    id: string
    userId: string
    prompt: string
    sourceTemplateId?: SourceTemplateId
  }): Promise<PlayableTaskRecord>
  findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined>
  renameOwnedTask(taskId: string, userId: string, title: string): Promise<boolean>
  deleteOwnedTask(taskId: string, userId: string): Promise<boolean>
  appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void>
  listMessages(taskId: string): Promise<PlayableTaskMessageRecord[]>
  updateRequirementBrief(taskId: string, userId: string, brief: RequirementBrief): Promise<boolean>
  updateGameplayAnnotations(taskId: string, userId: string, annotations: GameplayAnnotation[]): Promise<boolean>
  setActiveReferenceVideo(taskId: string, userId: string, assetId: string | null): Promise<boolean>
  setDraft(taskId: string, userId: string): Promise<boolean>
  setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean>
  setAwaitingRevision(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    revision: RevisionProposal,
  ): Promise<boolean>
  clearPendingRevision(taskId: string, userId: string): Promise<boolean>
  claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    buildId: string,
    revision?: RevisionProposal,
  ): Promise<PlayableTaskRecord | undefined>
  compareAndSetPhase(
    taskId: string,
    buildId: string,
    expected: PlayableTaskPhase,
    next: PlayableTaskPhase,
  ): Promise<boolean>
  publishArtifact(
    taskId: string,
    buildId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean>
  acceptArtifact(taskId: string, userId: string): Promise<boolean>
  requestRevision(taskId: string, userId: string): Promise<boolean>
  touchBuild(taskId: string, buildId: string): Promise<boolean>
  failStaleBuild(taskId: string, userId: string, staleBefore: Date): Promise<boolean>
  markFailed(taskId: string, buildId: string): Promise<boolean>
  listBuilds(taskId: string): Promise<PlayableBuildRecord[]>
  listBuildsForTasks?(taskIds: string[]): Promise<PlayableBuildRecord[]>
  findBuild(taskId: string, buildId: string): Promise<PlayableBuildRecord | undefined>
  appendEvent(event: { taskId: string; type: string; phase?: string; message?: string }): Promise<void>
  listEvents(taskId: string): Promise<PlayableEventRecord[]>
  listOwnedTasks(userId: string): Promise<PlayableTaskRecord[]>
  saveAsset(asset: PlayableAsset): Promise<void>
  listAssets(taskId: string, userId: string): Promise<PlayableAsset[]>
  findOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined>
  deleteOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined>
  // Required rather than optional. While it was optional the caller fell back
  // to a plain insert, which bypasses the claim entirely — harmless while the
  // unique index rejected duplicates, but now that `attempt` is part of that
  // index the fallback would quietly let two analyses of one video run at once.
  claimVideoAnalysis(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
    /**
     * Lets a claim start a new attempt past a succeeded one, for the user's
     * "look again" request. A running attempt still blocks regardless, so a
     * re-run can never bill two concurrent analyses of one video.
     */
    rerun?: boolean
  }): Promise<{ analysis: PlayableVideoAnalysisRecord; claimed: boolean }>
  findLatestVideoAnalysis(taskId: string, pipelineVersion: string): Promise<PlayableVideoAnalysisRecord | undefined>
  /**
   * What the blueprint is read from while a newer attempt is running or has
   * failed. Without it every re-run, and every intent comparison, would leave
   * the agent and the build without a blueprint until it finished.
   */
  findLatestSucceededVideoAnalysis(
    taskId: string,
    pipelineVersion: string,
    assetId: string,
  ): Promise<PlayableVideoAnalysisRecord | undefined>
  /**
   * Inserts an already-succeeded attempt at exactly `attempt`, returning
   * undefined if that number is taken. The fixed number is the guard: it only
   * lands if nothing was claimed after the analysis it was derived from.
   */
  recordIntentComparison(input: {
    id: string
    taskId: string
    assetId: string
    pipelineVersion: string
    model: string
    attempt: number
    blueprint: GameplayBlueprint
    mediaResolution: AppliedMediaResolution | null
    intentText: string
  }): Promise<PlayableVideoAnalysisRecord | undefined>
  updateVideoAnalysisStatus(id: string, status: VideoAnalysisStatus): Promise<void>
  completeVideoAnalysis(
    id: string,
    blueprint: GameplayBlueprint,
    mediaResolution: AppliedMediaResolution | null,
    intentText: string,
  ): Promise<void>
  failVideoAnalysis(id: string, errorCode: string): Promise<void>
  createResearchRun?(input: {
    id: string
    taskId: string
    userId: string
    brief: SearchBrief
    cacheKey: string
    strategyVersion: string
    sourceIds: string[]
  }): Promise<PlayableResearchRunRecord>
  updateResearchRunStatus?(id: string, taskId: string, status: ResearchRunStatus): Promise<boolean>
  completeResearchRun?(
    id: string,
    taskId: string,
    report: MarketResearchReport,
    cachedFromRunId?: string | null,
  ): Promise<MarketResearchReport>
  failResearchRun?(id: string, taskId: string, status: 'failed' | 'cancelled', errorCode: string): Promise<void>
  findReusableResearchReport?(
    userId: string,
    cacheKey: string,
    strategyVersion: string,
    notBefore: Date,
  ): Promise<MarketResearchReport | undefined>
  findResearchReport?(taskId: string, userId: string, runId: string): Promise<MarketResearchReport | undefined>
  saveReferenceSelection?(input: {
    id: string
    taskId: string
    userId: string
    selection: ReferenceSelectionInput
  }): Promise<ResolvedReferenceSelection | undefined>
  listReferenceSelections?(taskId: string, userId: string): Promise<PlayableReferenceSelectionRecord[]>
}

export type BackgroundScheduler = (work: () => Promise<void>) => void

interface HandlerDependencies {
  authenticate(request: NextRequest): Promise<string | undefined>
  readApiKey(request: NextRequest, userId: string): Promise<string | undefined>
  readMediaApiKey?(request: NextRequest, userId: string): Promise<string | undefined>
  repository: PlayableTaskRepository
  agent: PlayableAgentAdapter
  artifactStore: ArtifactStore
  schedule: BackgroundScheduler
  buildStartedEventTimeoutMs?: number
  buildHeartbeatIntervalMs?: number
  staleBuildTimeoutMs?: number
  requirementStreamKeepaliveMs?: number
  mediaGenerator?: MediaGenerator
  imageAnalyst?: ReferenceImageAnalyst
  videoAnalyst?: VideoGameplayAnalyst
  marketResearchAgent?: MarketResearchAgent
  generateId(): string
}

type MediaGenerator = (input: {
  taskId: string
  apiKey: string
  confirmation: ConfirmationProposal
}) => Promise<PlayableBuildAsset[]>

interface ConfirmedBuildDependencies {
  task: PlayableTaskRecord
  apiKey: string
  mediaApiKey?: string
  buildId: string
  repository: PlayableTaskRepository
  agent: PlayableAgentAdapter
  artifactStore: ArtifactStore
  mediaGenerator?: MediaGenerator
  gameplayBlueprint?: GameplayBlueprintDocument
  buildHeartbeatIntervalMs?: number
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.byteLength
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export function safeValidationSummary(
  value: unknown,
  delivery: ConfirmationProposal['delivery'] | undefined,
): PlayableValidationSummary | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    passed?: unknown
    buildPassed?: unknown
    deliveryCompliant?: unknown
    bytes?: unknown
    gates?: unknown
    delivery?: unknown
  }
  if (typeof candidate.bytes !== 'number' || !Number.isFinite(candidate.bytes) || candidate.bytes < 0) return null
  const gates =
    candidate.gates && typeof candidate.gates === 'object' ? (candidate.gates as Record<string, unknown>) : {}
  const hardGateKeys = [
    'schema',
    'behavior',
    'offlineResources',
    'responsiveViewport',
    'initialMute',
    'firstInteractionNavigation',
    'credentialScan',
  ]
  const buildPassed =
    typeof candidate.buildPassed === 'boolean'
      ? candidate.buildPassed
      : candidate.passed === true && !hardGateKeys.some((key) => gates[key] === 'failed')
  const deliveryCompliant =
    typeof candidate.deliveryCompliant === 'boolean' ? candidate.deliveryCompliant : gates.packageSize !== 'failed'
  const storedDelivery =
    candidate.delivery && typeof candidate.delivery === 'object'
      ? (candidate.delivery as { profileId?: unknown })
      : undefined
  const profile =
    storedDelivery && typeof storedDelivery.profileId === 'string' && isDeliveryProfileId(storedDelivery.profileId)
      ? getDeliveryProfile(storedDelivery.profileId)
      : getDeliveryProfile(deliveryProfileIdFor(delivery ?? deliveryProfileSnapshot('applovin')))
  return {
    buildPassed,
    deliveryCompliant,
    bytes: candidate.bytes,
    delivery: {
      profileId: profile.id,
      label: profile.label,
      maxBytes: profile.maxBytes,
    },
  }
}

function safeTaskState(task: PlayableTaskRecord) {
  return {
    phase: task.phase,
    hasArtifact: Boolean(task.latestArtifactKey),
    artifactVersion: task.latestArtifactKey?.split('/').at(-2) ?? null,
    latestValidation: safeValidationSummary(task.latestValidation, task.confirmation?.delivery),
    requirementBrief: task.requirementBrief ? sanitizeRequirementBrief(task.requirementBrief) : null,
    confirmation:
      task.phase !== 'draft' && task.confirmation
        ? sanitizeConfirmation(bindSourceTemplate(task.confirmation, selectedSourceTemplate(task)))
        : null,
    pendingRevision: task.pendingRevision ? sanitizeRevisionProposal(task.pendingRevision) : null,
  }
}

function taskListItem(task: PlayableTaskRecord) {
  return {
    id: task.id,
    title: task.title ?? null,
    prompt: safeString(task.prompt),
    ...safeTaskState(task),
    mode: task.confirmation?.mode ?? null,
    createdAt: task.createdAt?.toISOString() ?? null,
    updatedAt: task.updatedAt?.toISOString() ?? null,
  }
}

/**
 * Annotations are bound to the asset they describe and outlive a change of
 * active video, but only the active video's are in play: they are what the
 * agent resends, what the user sees, and what joins the blueprint document.
 */
function activeGameplayAnnotations(task: PlayableTaskRecord): GameplayAnnotation[] {
  const assetId = task.activeReferenceVideoAssetId
  return assetId ? task.gameplayAnnotations.filter((annotation) => annotation.assetId === assetId) : []
}

function safeVideoAnalysis(current: CurrentVideoAnalysis | undefined) {
  if (!current) return null
  const { latest, source } = current
  return {
    id: latest.id,
    assetId: latest.assetId,
    status: videoAnalysisStatusSchema.parse(latest.status),
    attempt: latest.attempt,
    // Surfaced so the UI can say the analysis ran degraded and offer a re-run.
    // Without it, a low-resolution result is indistinguishable from a good one.
    // Taken from the blueprint's own attempt, since that is what it describes.
    mediaResolution: source?.mediaResolution ?? null,
    blueprint: source?.blueprint ? gameplayBlueprintSchema.parse(source.blueprint) : null,
    intentPending: current.intentPending,
    errorCode: latest.errorCode,
    createdAt: latest.createdAt.toISOString(),
    completedAt: latest.completedAt?.toISOString() ?? null,
  }
}

const TOOL_PROGRESS_COPY = {
  inspect_reference_images: {
    tool_started: '正在分析参考图片',
    tool_completed: '参考图片分析完成',
    tool_pending: '参考图片分析尚未完成',
    tool_failed: '参考图片分析暂不可用',
  },
  analyze_reference_video: {
    tool_started: '正在分析参考视频',
    tool_completed: '参考视频分析完成',
    tool_pending: '参考视频分析尚未完成',
    tool_failed: '参考视频分析暂不可用',
  },
  search_market_references: {
    tool_started: '正在搜索同类试玩参考',
    tool_completed: '同类试玩参考搜索完成',
    tool_pending: '同类试玩参考搜索尚未完成',
    tool_failed: '同类试玩参考搜索暂不可用',
  },
} as const

const RESEARCH_PROGRESS_COPY: Record<MarketResearchProgressStage, string> = {
  searching: '正在检索公开来源',
  filtering: '正在筛选和去重',
  analyzing: '正在分析玩法',
  summarizing: '正在整理推荐',
}

function toolProgressEvent(
  type: 'tool_started' | 'tool_completed' | 'tool_pending' | 'tool_failed',
  tool: RequirementAnalysisToolCall['name'],
) {
  return { type, tool, message: TOOL_PROGRESS_COPY[tool][type] }
}

const ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'"
// Packed game bootstrappers evaluate embedded scripts. Keep this capability scoped to
// the opaque-origin sandbox, without same-origin access or network connections.
const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; sandbox allow-scripts; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
const DEFAULT_BUILD_STARTED_EVENT_TIMEOUT_MS = 1_000
const DEFAULT_BUILD_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_STALE_BUILD_TIMEOUT_MS = 3 * 60 * 1000
const STALE_BUILD_FAILURE_MESSAGE = '构建进程已停止，请重新确认方案并重试。'

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

async function ownedTask(
  request: NextRequest,
  context: RouteContext,
  dependencies: HandlerDependencies,
): Promise<{ userId: string; task: PlayableTaskRecord } | Response> {
  const userId = await dependencies.authenticate(request)
  if (!userId) return jsonError(401, 'Unauthorized')
  const { taskId } = await context.params
  const task = await dependencies.repository.findOwnedTask(taskId, userId)
  if (!task) return jsonError(404, 'Not found')
  return { userId, task }
}

function safeString(value: string, secrets: readonly string[] = []): string {
  return redactSecrets(value, secrets)
}

function requirementFailureMessage(cause: unknown): string {
  if (!(cause instanceof PlayableAgentError)) return '助手暂时无法继续整理需求，请重试'
  if (cause.code === 'sandbox_configuration') {
    return '本地 Harness 缺少 Vercel Sandbox 凭据，请配置后重启服务'
  }
  if (cause.code === 'session_start_failed') return '无法启动 Agent 会话，请检查 Sandbox 配置后重试'
  if (cause.code === 'stream_failed') return 'Agent 响应流中断，请检查网络与模型权限后重试'
  return 'Agent 返回的需求方案格式无效，请重试'
}

function logRequirementFailure(cause: unknown): void {
  if (!(cause instanceof PlayableAgentError)) {
    console.error('Playable requirement processing failed')
    return
  }
  if (cause.code === 'sandbox_configuration') {
    console.error('Playable requirement processing failed: sandbox credentials unavailable')
    return
  }
  if (cause.code === 'session_start_failed') {
    console.error('Playable requirement processing failed: session start failed')
    return
  }
  if (cause.code === 'stream_failed') {
    console.error('Playable requirement processing failed: agent stream failed')
    return
  }
  console.error('Playable requirement processing failed: agent output invalid')
}

type RequirementProcessingStage =
  | 'context_load'
  | 'user_message_store'
  | 'agent_reply'
  | 'reply_validation'
  | 'annotation_store'
  | 'brief_store'
  | 'agent_message_store'
  | 'phase_transition'

function requirementStageFailureMessage(stage: RequirementProcessingStage): string {
  if (stage === 'context_load') return '无法读取任务上下文，请检查数据库连接后重试'
  if (stage === 'user_message_store') return '无法保存你的消息，请检查数据库连接后重试'
  if (stage === 'reply_validation') return 'Agent 返回的需求方案未通过校验，请重试'
  if (stage === 'annotation_store') return '无法保存玩法标注，请检查数据库后重试'
  if (stage === 'brief_store') return '无法保存实时 Brief，请检查数据库后重试'
  if (stage === 'agent_message_store') return '无法保存助手回复，请检查数据库后重试'
  if (stage === 'phase_transition') return '任务状态已变化，请刷新后重试'
  return '助手暂时无法继续整理需求，请重试'
}

function logRequirementStageFailure(stage: RequirementProcessingStage): void {
  if (stage === 'context_load') {
    console.error('Playable requirement processing failed: context load failed')
    return
  }
  if (stage === 'user_message_store') {
    console.error('Playable requirement processing failed: user message store failed')
    return
  }
  if (stage === 'reply_validation') {
    console.error('Playable requirement processing failed: reply validation failed')
    return
  }
  if (stage === 'annotation_store') {
    console.error('Playable requirement processing failed: annotation store failed')
    return
  }
  if (stage === 'brief_store') {
    console.error('Playable requirement processing failed: brief store failed')
    return
  }
  if (stage === 'agent_message_store') {
    console.error('Playable requirement processing failed: agent message store failed')
    return
  }
  if (stage === 'phase_transition') {
    console.error('Playable requirement processing failed: phase transition failed')
    return
  }
  console.error('Playable requirement processing failed: agent reply failed')
}

function sanitizeConfirmation(value: ConfirmationProposal, secrets: readonly string[] = []): ConfirmationProposal {
  return confirmationProposalSchema.parse(JSON.parse(redactSecrets(JSON.stringify(value), secrets)))
}

function sanitizeAgentReply(value: PlayableAgentReply, secrets: readonly string[] = []): PlayableAgentReply {
  return playableAgentReplySchema.parse(JSON.parse(redactSecrets(JSON.stringify(value), secrets)))
}

function sanitizeRequirementBrief(value: RequirementBrief, secrets: readonly string[] = []): RequirementBrief {
  return requirementBriefSchema.parse(JSON.parse(redactSecrets(JSON.stringify(value), secrets)))
}

function sanitizeRevisionProposal(value: RevisionProposal, secrets: readonly string[] = []): RevisionProposal {
  return revisionProposalSchema.parse(JSON.parse(redactSecrets(JSON.stringify(value), secrets)))
}

function resolveRevisionProposal(input: {
  plan: RevisionPlan
  builds: PlayableBuildRecord[]
  latestArtifactKey: string
  id: string
}): RevisionProposal {
  const successfulBuilds = input.builds.filter(
    (build): build is PlayableBuildRecord & { artifactKey: string } =>
      build.status === 'succeeded' && Boolean(build.artifactKey),
  )
  const baseIndex = successfulBuilds.findIndex((build) => build.artifactKey === input.latestArtifactKey)
  if (baseIndex < 0) throw new Error('Current playable build is missing')
  return revisionProposalSchema.parse({
    id: input.id,
    baseBuildId: successfulBuilds[baseIndex].id,
    baseVersion: baseIndex + 1,
    targetVersion: successfulBuilds.length + 1,
    ...input.plan,
  })
}

function conversationContent(message: PlayableTaskMessageRecord, secrets: readonly string[]): string {
  const safeContent = safeString(message.content, secrets)
  if (message.role === 'user') return safeContent
  try {
    const parsed = playableAgentReplySchema.safeParse(JSON.parse(safeContent))
    return parsed.success ? parsed.data.message : safeContent
  } catch {
    return safeContent
  }
}

function containsExactSecret(value: string, secret: string): boolean {
  return secret.length > 0 && value.includes(secret)
}

async function settleWithin(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([operation.catch(() => undefined), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const DEFAULT_BUILD_FAILURE_MESSAGE = '试玩构建失败，请重试。'
const QUOTA_BUILD_FAILURE_MESSAGE = 'AI 服务额度暂时不可用，请联系管理员后重试。'
const SANDBOX_PAYMENT_BUILD_FAILURE_MESSAGE = 'Vercel Sandbox 额度不足，请升级套餐或等待额度重置后重试。'
const CODEX_OVERLOAD_BUILD_FAILURE_MESSAGE = 'Codex 服务当前繁忙，自动重试后仍未完成，请稍后再试。'
const CODEX_AUTH_BUILD_FAILURE_MESSAGE = 'Codex API Key 无效，或当前账号没有所选模型的访问权限，请检查配置后重试。'
const CODEX_RATE_LIMIT_BUILD_FAILURE_MESSAGE = 'Codex 请求频率已达到限制，请稍后再试。'
const CODEX_CONNECTION_BUILD_FAILURE_MESSAGE = 'Codex 连接中断，自动重试后仍未完成，请稍后再试。'
const CODEX_BUILD_FAILURE_MESSAGE = 'Agent 执行失败，未发布试玩产物。请查看构建步骤和服务端错误日志后重试。'

function externalErrorText(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (typeof current === 'string') {
      parts.push(current)
      break
    }
    if (typeof current !== 'object') break
    const candidate = current as {
      cause?: unknown
      lastError?: unknown
      message?: unknown
      responseBody?: unknown
    }
    if (typeof candidate.message === 'string') parts.push(candidate.message)
    if (typeof candidate.responseBody === 'string') parts.push(candidate.responseBody)
    current = candidate.lastError ?? candidate.cause
  }
  return parts.join('\n').toLowerCase()
}

function externalResponseStatus(error: unknown): number | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (typeof current !== 'object') return
    const candidate = current as {
      cause?: unknown
      response?: { status?: unknown; statusCode?: unknown }
      status?: unknown
      statusCode?: unknown
    }
    const status =
      candidate.response?.status ?? candidate.response?.statusCode ?? candidate.status ?? candidate.statusCode
    if (typeof status === 'number') return status
    current = candidate.cause
  }
}

function buildFailureMessage(stage: ConfirmedBuildStage, cause: unknown): string {
  if (stage !== 'agent' || !(cause instanceof Error)) return DEFAULT_BUILD_FAILURE_MESSAGE
  const message = externalErrorText(cause)
  if (
    message.includes('no credits remaining') ||
    message.includes('insufficient_quota') ||
    message.includes('exceeded your current quota')
  ) {
    return QUOTA_BUILD_FAILURE_MESSAGE
  }
  if (cause instanceof PlayableBuildExecutionError) {
    if (cause.stage === 'sandbox_create' && externalResponseStatus(cause) === 402) {
      return SANDBOX_PAYMENT_BUILD_FAILURE_MESSAGE
    }
    if (cause.stage === 'workspace') return '无法准备试玩构建环境，请重试。'
    if (cause.stage === 'agent') {
      const status = externalResponseStatus(cause)
      if (message.includes('servers are currently overloaded') || message.includes('server is overloaded')) {
        return CODEX_OVERLOAD_BUILD_FAILURE_MESSAGE
      }
      if (
        status === 401 ||
        status === 403 ||
        message.includes('invalid_api_key') ||
        message.includes('incorrect api key') ||
        message.includes('model access')
      ) {
        return CODEX_AUTH_BUILD_FAILURE_MESSAGE
      }
      if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
        return CODEX_RATE_LIMIT_BUILD_FAILURE_MESSAGE
      }
      if (
        message.includes('stream disconnected before completion') ||
        message.includes('connection reset') ||
        message.includes('network error') ||
        message.includes('timed out')
      ) {
        return CODEX_CONNECTION_BUILD_FAILURE_MESSAGE
      }
      if (message.includes('agent stream failed')) return 'Agent 响应流中断，未完成构建，请重试。'
      return CODEX_BUILD_FAILURE_MESSAGE
    }
    if (cause.stage === 'integrity') return '试玩 Skill 完整性检查失败，请重试。'
    if (cause.stage === 'artifact_build') return '试玩产物构建失败，请调整修改要求后重试。'
    if (cause.stage === 'validation') return '试玩行为校验失败，请调整修改要求后重试。'
    return '试玩产物安全检查失败，请调整修改要求后重试。'
  }
  return DEFAULT_BUILD_FAILURE_MESSAGE
}

async function recordBuildFailure(
  repository: PlayableTaskRepository,
  taskId: string,
  buildId: string,
  message = DEFAULT_BUILD_FAILURE_MESSAGE,
): Promise<void> {
  let failed = true
  try {
    failed = await repository.markFailed(taskId, buildId)
  } catch {
    // Preserve a terminal event when persistence fails unexpectedly.
  }
  if (!failed) return
  await repository
    .appendEvent({
      taskId,
      type: 'build_failed',
      phase: 'failed',
      message,
    })
    .catch(() => undefined)
}

function startBuildHeartbeat(
  repository: PlayableTaskRepository,
  taskId: string,
  buildId: string,
  intervalMs: number,
): () => void {
  let stopped = false
  let heartbeatPending = false
  const heartbeat = () => {
    if (stopped || heartbeatPending) return
    heartbeatPending = true
    void repository
      .touchBuild(taskId, buildId)
      .catch(() => undefined)
      .finally(() => {
        heartbeatPending = false
      })
  }
  heartbeat()
  const timer = setInterval(heartbeat, intervalMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

async function reconcileStaleBuild(
  repository: PlayableTaskRepository,
  task: PlayableTaskRecord,
  staleBuildTimeoutMs: number,
): Promise<void> {
  if (!['building', 'validating'].includes(task.phase) || !task.updatedAt) return
  const staleBefore = new Date(Date.now() - staleBuildTimeoutMs)
  if (task.updatedAt >= staleBefore) return
  const failed = await repository.failStaleBuild(task.id, task.userId, staleBefore)
  if (!failed) return
  await repository
    .appendEvent({
      taskId: task.id,
      type: 'build_failed',
      phase: 'failed',
      message: STALE_BUILD_FAILURE_MESSAGE,
    })
    .catch(() => undefined)
}

type ConfirmedBuildStage =
  | 'confirmation'
  | 'base_artifact'
  | 'assets'
  | 'media'
  | 'agent'
  | 'validation'
  | 'artifact_store'
  | 'publish'

const HARD_VALIDATION_GATES = [
  'schema',
  'behavior',
  'offlineResources',
  'responsiveViewport',
  'initialMute',
  'firstInteractionNavigation',
  'credentialScan',
] as const

function logConfirmedBuildFailure(stage: ConfirmedBuildStage, cause: unknown): void {
  if (stage === 'confirmation') console.error('Playable build failed during confirmation validation')
  else if (stage === 'base_artifact') console.error('Playable build failed while loading the base artifact')
  else if (stage === 'assets') console.error('Playable build failed while loading assets')
  else if (stage === 'media') console.error('Playable build failed during media generation')
  else if (
    stage === 'agent' &&
    cause instanceof PlayableBuildExecutionError &&
    cause.stage === 'sandbox_create' &&
    externalResponseStatus(cause) === 402
  ) {
    console.error('Playable build failed while creating Vercel Sandbox: payment required')
  } else if (stage === 'agent') console.error('Playable build failed during Sandbox agent execution')
  else if (stage === 'validation') console.error('Playable build failed during validation')
  else if (stage === 'artifact_store') console.error('Playable build failed while storing artifacts')
  else console.error('Playable build failed while publishing artifacts')
}

function eventJson(event: PlayableEventRecord) {
  return {
    id: event.id,
    type: event.type,
    ...(event.phase ? { phase: event.phase } : {}),
    ...(event.message ? { message: safeString(event.message) } : {}),
    createdAt: event.createdAt.toISOString(),
  }
}

function artifactPrefix(task: PlayableTaskRecord, buildId: string): string {
  return `users/${task.userId}/tasks/${task.id}/${buildId}`
}

export async function runConfirmedBuild(dependencies: ConfirmedBuildDependencies): Promise<void> {
  const { task, apiKey, mediaApiKey, buildId, repository, agent, artifactStore } = dependencies
  const generationApiKey = mediaApiKey ?? apiKey
  if (!task.confirmation) {
    await recordBuildFailure(repository, task.id, buildId)
    return
  }

  const stopHeartbeat = startBuildHeartbeat(
    repository,
    task.id,
    buildId,
    dependencies.buildHeartbeatIntervalMs ?? DEFAULT_BUILD_HEARTBEAT_INTERVAL_MS,
  )

  // 顺序写入步骤事件，确保工具先开始再结束；终止事件前要等待队列排空。
  // 公开详情在排队前统一脱敏，不写入控制台；原始事件、环境和隐藏推理不落库。
  const activitySecrets = [
    apiKey,
    mediaApiKey ?? '',
    ...Object.entries(process.env)
      .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|POSTGRES_URL|TEAM_ID|PROJECT_ID/.test(key))
      .map(([, value]) => value ?? ''),
  ]
  let activityQueue = Promise.resolve()
  const onActivity: BuildActivityCallback = (activity, detail) => {
    if (!Object.hasOwn(buildActivityLabels, activity)) return
    const message = detail
      ? JSON.stringify({ version: 1, detail: sanitizeBuildActivityDetail(detail, activitySecrets) })
      : buildActivityLabels[activity]
    activityQueue = activityQueue
      .then(async () => {
        await repository.appendEvent({
          taskId: task.id,
          type: `build_activity_${activity}`,
          message,
        })
      })
      .catch(() => {
        console.error('Unable to persist build activity')
      })
  }
  let stage: ConfirmedBuildStage = 'confirmation'
  try {
    if (
      containsExactSecret(JSON.stringify(task.confirmation), apiKey) ||
      (mediaApiKey && containsExactSecret(JSON.stringify(task.confirmation), mediaApiKey))
    ) {
      throw new Error('Confirmation contains a credential')
    }
    const sanitizedConfirmation = sanitizeConfirmation(
      bindSourceTemplate(task.confirmation, selectedSourceTemplate(task)),
      [apiKey, ...(mediaApiKey ? [mediaApiKey] : [])],
    )
    const revision = task.pendingRevision
      ? sanitizeRevisionProposal(task.pendingRevision, [apiKey, ...(mediaApiKey ? [mediaApiKey] : [])])
      : undefined
    let baseHtml: string | undefined
    if (sanitizedConfirmation.sourceTemplateId && revision?.strategy !== 'patch') {
      baseHtml = await readFile(
        path.join(
          process.cwd(),
          MAHJONG_PLAYABLE_PLUGIN.skillRoot,
          'assets/templates',
          sanitizedConfirmation.sourceTemplateId,
          'source.html',
        ),
        'utf8',
      )
    }
    if (revision?.strategy === 'patch') {
      stage = 'base_artifact'
      const baseBuild = await repository.findBuild(task.id, revision.baseBuildId)
      if (!baseBuild || baseBuild.status !== 'succeeded' || !baseBuild.artifactKey) {
        throw new Error('Revision base artifact is missing')
      }
      const baseStream = await artifactStore.get(baseBuild.artifactKey)
      if (!baseStream) throw new Error('Revision base artifact is missing')
      baseHtml = new TextDecoder().decode(await readAll(baseStream))
    }
    if (
      !MAHJONG_PLAYABLE_PLUGIN.capabilities.aiMediaGeneration &&
      Object.values(sanitizedConfirmation.resources).some((resource) => resource.status === '待生成')
    ) {
      throw new Error('AI media generation is not supported')
    }
    stage = 'assets'
    const storedAssets = await repository.listAssets(task.id, task.userId)
    const uploadedAssets = await Promise.all(
      storedAssets
        .filter(
          (asset): asset is PlayableAsset & { slot: keyof ConfirmationProposal['resources'] } =>
            isPlayableResourceAssetSlot(asset.slot) &&
            sanitizedConfirmation.resources[asset.slot].status === '用户上传',
        )
        .map(async (asset) => {
          const stream = await artifactStore.get(asset.storageKey)
          if (!stream) throw new Error('Uploaded asset is missing')
          return {
            id: asset.id,
            slot: asset.slot,
            filename: asset.filename,
            mimeType: asset.mimeType,
            size: asset.size,
            bytes: await readAll(stream),
          }
        }),
    )
    const needsGeneratedMedia = Object.values(sanitizedConfirmation.resources).some(
      (resource) => resource.status === '待生成',
    )
    stage = 'media'
    const mediaGenerator = dependencies.mediaGenerator ?? generatePlayableMediaAssets
    const generatedAssets = needsGeneratedMedia
      ? await mediaGenerator({
          taskId: task.id,
          apiKey: generationApiKey,
          confirmation: sanitizedConfirmation,
        })
      : []
    const assets = [...uploadedAssets, ...generatedAssets]
    stage = 'agent'
    const result = await agent.build({
      onActivity,
      taskId: task.id,
      apiKey,
      confirmation: sanitizedConfirmation,
      assets,
      ...(revision ? { revision } : {}),
      ...(baseHtml ? { baseHtml } : {}),
      ...(dependencies.gameplayBlueprint ? { gameplayBlueprint: dependencies.gameplayBlueprint } : {}),
    })
    await activityQueue
    stage = 'validation'
    if (
      !result.validation.buildPassed ||
      HARD_VALIDATION_GATES.some((gate) => result.validation.gates[gate] !== 'passed')
    ) {
      throw new Error('Playable validation gates failed')
    }
    if (containsExactSecret(result.html, apiKey)) throw new Error('Artifact contains a credential')
    if (redactSecrets(result.html) !== result.html) throw new Error('Artifact contains a credential')
    const validating = await repository.compareAndSetPhase(task.id, buildId, 'building', 'validating')
    if (!validating) {
      await recordBuildFailure(repository, task.id, buildId)
      return
    }

    const prefix = artifactPrefix(task, buildId)
    const playableKey = `${prefix}/playable.html`
    const validationReport = result.validation
    const productionConfig = createProductionConfig(sanitizedConfirmation)
    const assetManifest = result.assetManifest ?? createAssetSourceManifest(sanitizedConfirmation, assets)
    stage = 'artifact_store'
    console.log('Storing playable artifacts')
    await artifactStore.put(`${prefix}/production-config.json`, JSON.stringify(productionConfig), 'application/json')
    await artifactStore.put(`${prefix}/asset-manifest.json`, JSON.stringify(assetManifest), 'application/json')
    await artifactStore.put(`${prefix}/validation-report.json`, JSON.stringify(validationReport), 'application/json')
    if (dependencies.gameplayBlueprint) {
      await artifactStore.put(
        `${prefix}/gameplay-blueprint.json`,
        JSON.stringify(dependencies.gameplayBlueprint),
        'application/json',
      )
    }
    await artifactStore.put(playableKey, result.html, 'text/html; charset=utf-8')

    stage = 'publish'
    const published = await repository.publishArtifact(task.id, buildId, 'validating', playableKey, validationReport)
    if (!published) {
      await recordBuildFailure(repository, task.id, buildId)
      return
    }
    console.log('Playable artifacts published')
    await repository
      .appendEvent({
        taskId: task.id,
        type: 'build_succeeded',
        phase: 'ready',
        message: 'Playable build is ready',
      })
      .catch(() => undefined)
  } catch (cause) {
    await activityQueue
    logConfirmedBuildFailure(stage, cause)
    await recordBuildFailure(repository, task.id, buildId, buildFailureMessage(stage, cause))
  } finally {
    stopHeartbeat()
  }
}

export function createPlayableTaskHandlers(dependencies: HandlerDependencies) {
  const videoAnalysisClaims = new Map<string, Promise<{ analysis: PlayableVideoAnalysisRecord; claimed: boolean }>>()

  const claimVideoAnalysis = async (taskId: string, assetId: string, model: string, rerun: boolean) => {
    // Deliberately keyed without `attempt`. This map exists to collapse
    // concurrent requests within one process into a single claim; including the
    // attempt number would make every key unique and defeat the whole purpose.
    const key = `${assetId}:${VIDEO_ANALYSIS_PIPELINE_VERSION}:${model}`
    const pending = videoAnalysisClaims.get(key)
    if (pending) {
      const result = await pending
      return { analysis: result.analysis, claimed: false }
    }
    const claim = dependencies.repository.claimVideoAnalysis({
      id: dependencies.generateId(),
      taskId,
      assetId,
      pipelineVersion: VIDEO_ANALYSIS_PIPELINE_VERSION,
      model,
      rerun,
    })
    videoAnalysisClaims.set(key, claim)
    try {
      return await claim
    } finally {
      videoAnalysisClaims.delete(key)
    }
  }

  /**
   * Returns the current analysis for a task, treating an abandoned one as
   * failed. A function killed by the platform never reaches `failVideoAnalysis`,
   * so without this the row sits in `analyzing` forever and the UI spins. The
   * gap has always existed; analysing on upload just makes it easy to hit.
   */
  const readCurrentAnalysis = async (
    task: PlayableTaskRecord,
    assetId: string | null,
  ): Promise<CurrentVideoAnalysis | undefined> => {
    const found = await dependencies.repository.findLatestVideoAnalysis(task.id, VIDEO_ANALYSIS_PIPELINE_VERSION)
    // The active video can change, and the latest analysis may belong to the
    // one it replaced. That is "not analysed yet", not a result.
    if (!found || !assetId || found.assetId !== assetId) return undefined
    let latest = found
    if (RUNNING_ANALYSIS_STATUSES.has(found.status) && Date.now() - found.createdAt.getTime() >= STALE_ANALYSIS_MS) {
      await dependencies.repository.failVideoAnalysis(found.id, 'analysis_abandoned').catch(() => undefined)
      latest = { ...found, status: 'failed', errorCode: 'analysis_abandoned' }
    }
    const source =
      latest.status === 'succeeded'
        ? latest
        : await dependencies.repository.findLatestSucceededVideoAnalysis(
            task.id,
            VIDEO_ANALYSIS_PIPELINE_VERSION,
            assetId,
          )
    // Only owed against a settled result. A running attempt records whatever
    // intent was current when it started, and is reconciled when it finishes.
    const intent = deriveGameplayIntent(task.requirementBrief, task.prompt)
    const intentPending =
      latest.status === 'succeeded' && Boolean(latest.blueprint) && intent !== '' && intent !== latest.intentText
    return { latest, source, intentPending }
  }

  /**
   * The single place a stored blueprint becomes the document handed to the
   * requirement agent and the build sandbox. Annotations are filtered to the
   * analysed asset: they are bound to an asset and outlive a change of active
   * video, so an unfiltered join would describe the old video's timeline.
   */
  const gameplayBlueprintDocumentFor = async (task: PlayableTaskRecord) => {
    const source = (await readCurrentAnalysis(task, task.activeReferenceVideoAssetId))?.source
    if (!source?.blueprint) return undefined
    return toGameplayBlueprintDocument(
      gameplayBlueprintSchema.parse(source.blueprint),
      task.gameplayAnnotations.filter((annotation) => annotation.assetId === source.assetId),
    )
  }

  const intentComparisonsInFlight = new Set<string>()

  /**
   * Brings intent divergence up to date with the brief (spec section 6.4). Run
   * after a brief is stored and after a video analysis finishes, which between
   * them cover uploading before describing as well as the reverse. Text only
   * and never re-reads the video, so it is cheap enough to run on every change.
   */
  const reconcileIntentDivergence = async (taskId: string, userId: string) => {
    const analyst = dependencies.videoAnalyst
    if (!analyst) return
    const task = await dependencies.repository.findOwnedTask(taskId, userId)
    if (!task) return
    const current = await readCurrentAnalysis(task, task.activeReferenceVideoAssetId)
    if (!current?.intentPending) return
    const base = current.latest
    // Collapses a burst of brief updates in one process into one comparison;
    // the next update after it lands will see whether the intent moved again.
    if (intentComparisonsInFlight.has(base.id)) return
    intentComparisonsInFlight.add(base.id)
    try {
      const asset = await dependencies.repository.findOwnedAsset(task.id, userId, base.assetId)
      if (!asset) return
      await runIntentComparison({
        id: dependencies.generateId(),
        task,
        asset,
        analysis: base,
        intent: deriveGameplayIntent(task.requirementBrief, task.prompt),
        repository: dependencies.repository,
        analyst,
        abortSignal: AbortSignal.timeout(INTENT_COMPARISON_BUDGET_MS),
      })
    } finally {
      intentComparisonsInFlight.delete(base.id)
    }
  }

  const scheduleIntentReconciliation = (taskId: string, userId: string) => {
    try {
      dependencies.schedule(() =>
        reconcileIntentDivergence(taskId, userId).catch(() => {
          console.error('Intent divergence reconciliation failed')
        }),
      )
    } catch {
      console.error('Unable to schedule intent divergence reconciliation')
    }
  }

  /**
   * The agent resends the whole list every turn, so this replaces rather than
   * appends; an annotation the agent dropped is a deletion. Ids are minted per
   * write because the drafts carry none, and the list is bound to the active
   * reference video so it stays attributable after the user swaps videos.
   */
  const storeGameplayAnnotations = async (
    task: PlayableTaskRecord,
    userId: string,
    drafts: readonly GameplayAnnotationDraft[],
  ) => {
    const assetId = task.activeReferenceVideoAssetId
    if (!assetId) return
    const current: GameplayAnnotation[] = drafts.map((draft) => ({
      ...draft,
      id: dependencies.generateId(),
      assetId,
      source: 'user',
      confidence: 1,
    }))
    // Only the active video's list is replaced. The agent is shown just that
    // list, so another video's annotations were never its to resend; dropping
    // them here would delete the user's statements about a video they merely
    // switched away from.
    const others = task.gameplayAnnotations.filter((annotation) => annotation.assetId !== assetId)
    const annotations = [...current, ...others].slice(0, MAX_GAMEPLAY_ANNOTATIONS)
    await dependencies.repository.updateGameplayAnnotations(task.id, userId, annotations)
    task.gameplayAnnotations = annotations
  }

  const executeRequirementAnalysisTool = async (input: {
    call: RequirementAnalysisToolCall
    task: PlayableTaskRecord
    userId: string
    apiKey: string
    allowedAssetIds: ReadonlySet<string>
    cache: Map<string, unknown>
    budget: { imagesExecuted: boolean }
    abortSignal?: AbortSignal
    onResearchProgress?: (stage: MarketResearchProgressStage) => void
  }): Promise<
    ReferenceImageAnalysis | MarketResearchReport | { status: string; blueprint?: GameplayBlueprint; reason?: string }
  > => {
    if (input.call.name === 'search_market_references') {
      const repository = dependencies.repository
      if (
        !dependencies.marketResearchAgent ||
        !repository.createResearchRun ||
        !repository.updateResearchRunStatus ||
        !repository.completeResearchRun ||
        !repository.failResearchRun
      ) {
        return { status: 'unavailable', reason: 'research_unavailable' }
      }
      const runId = dependencies.generateId()
      const cacheKey = createResearchCacheKey(input.call.searchBrief)
      await repository.createResearchRun({
        id: runId,
        taskId: input.task.id,
        userId: input.userId,
        brief: input.call.searchBrief,
        cacheKey,
        strategyVersion: MARKET_RESEARCH_STRATEGY_VERSION,
        sourceIds: allowedResearchDomains(),
      })
      await repository.appendEvent({
        taskId: input.task.id,
        type: 'research_confirmed',
        message: 'Market research confirmed',
      })
      try {
        const reusable = repository.findReusableResearchReport
          ? await repository.findReusableResearchReport(
              input.userId,
              cacheKey,
              MARKET_RESEARCH_STRATEGY_VERSION,
              new Date(Date.now() - MARKET_RESEARCH_CACHE_TTL_MS),
            )
          : undefined
        await repository.updateResearchRunStatus(runId, input.task.id, 'searching')
        await repository.appendEvent({
          taskId: input.task.id,
          type: 'research_started',
          message: 'Market research started',
        })
        const result =
          reusable ??
          (await dependencies.marketResearchAgent.search(
            { runId, apiKey: input.apiKey, brief: input.call.searchBrief },
            {
              abortSignal: input.abortSignal,
              onProgress(stage) {
                input.onResearchProgress?.(stage)
                if (stage === 'analyzing') {
                  void repository.updateResearchRunStatus?.(runId, input.task.id, 'analyzing')
                }
              },
            },
          ))
        return await repository.completeResearchRun(runId, input.task.id, { ...result, runId }, reusable?.runId ?? null)
      } catch {
        const cancelled = Boolean(input.abortSignal?.aborted)
        await repository.failResearchRun(
          runId,
          input.task.id,
          cancelled ? 'cancelled' : 'failed',
          cancelled ? 'cancelled' : 'unavailable',
        )
        await repository.appendEvent({
          taskId: input.task.id,
          type: cancelled ? 'research_cancelled' : 'research_failed',
          message: cancelled ? 'Market research cancelled' : 'Market research failed',
        })
        return { status: 'unavailable', reason: cancelled ? 'research_cancelled' : 'research_unavailable' }
      }
    }
    if (input.call.name === 'inspect_reference_images') {
      const assetIds = [...new Set(input.call.assetIds)].sort()
      const cacheKey = JSON.stringify({ name: input.call.name, assetIds })
      if (input.cache.has(cacheKey)) return input.cache.get(cacheKey) as ReferenceImageAnalysis
      if (assetIds.some((assetId) => !input.allowedAssetIds.has(assetId))) {
        return { status: 'unavailable', reason: 'asset_not_attached' }
      }
      if (input.budget.imagesExecuted) return { status: 'unavailable', reason: 'budget_exceeded' }
      if (!dependencies.imageAnalyst) return { status: 'unavailable', reason: 'analysis_unavailable' }
      const assets = await Promise.all(
        assetIds.map((assetId) => dependencies.repository.findOwnedAsset(input.task.id, input.userId, assetId)),
      )
      if (assets.some((asset) => !asset || asset.slot !== 'referenceImage')) {
        return { status: 'unavailable', reason: 'asset_unavailable' }
      }
      const images = await Promise.all(
        assets.map(async (asset) => {
          if (!asset) throw new Error('Reference image is unavailable')
          const stream = await dependencies.artifactStore.get(asset.storageKey)
          if (!stream) throw new Error('Reference image is unavailable')
          return {
            assetId: asset.id,
            mimeType: asset.mimeType,
            bytes: await readAll(stream),
          }
        }),
      )
      input.budget.imagesExecuted = true
      const analysis = await dependencies.imageAnalyst.analyze({
        taskId: input.task.id,
        apiKey: input.apiKey,
        prompt: input.task.prompt,
        images,
        abortSignal: input.abortSignal,
      })
      const result = referenceImageAnalysisSchema.parse(
        JSON.parse(redactSecrets(JSON.stringify(analysis)).split(input.apiKey).join('[REDACTED]')),
      )
      input.cache.set(cacheKey, result)
      return result
    }

    // Reads an analysis that upload already started; it no longer runs one.
    // The synchronous path used to hold the whole NDJSON stream open for as
    // long as Gemini took, which is what forced the per-tool locks. Waiting is
    // now the caller's problem: the agent is told the state and moves on.
    const cacheKey = JSON.stringify({ name: input.call.name, assetId: input.call.assetId })
    if (input.cache.has(cacheKey)) {
      return input.cache.get(cacheKey) as { status: string; blueprint?: GameplayBlueprint; reason?: string }
    }
    if (!input.allowedAssetIds.has(input.call.assetId)) {
      return { status: 'unavailable', reason: 'asset_not_attached' }
    }
    if (!dependencies.videoAnalyst) return { status: 'unavailable', reason: 'analysis_unavailable' }
    const asset = await dependencies.repository.findOwnedAsset(input.task.id, input.userId, input.call.assetId)
    if (!asset || asset.slot !== 'referenceVideo') return { status: 'unavailable', reason: 'asset_unavailable' }

    const current = await readCurrentAnalysis(input.task, asset.id)
    if (!current) return { status: 'unavailable', reason: 'analysis_not_started' }
    const { latest, source } = current
    // A blueprint from an earlier attempt is still an observation of this
    // video, so a re-run in progress does not take it away from the agent.
    if (source?.blueprint) {
      const result = { status: 'succeeded', blueprint: gameplayBlueprintSchema.parse(source.blueprint) }
      if (source === latest) input.cache.set(cacheKey, result)
      return result
    }
    if (latest.status === 'failed') return { status: 'analysis_failed', reason: latest.errorCode ?? 'analysis_failed' }
    return { status: 'unavailable', reason: 'analysis_pending' }
  }

  return {
    async list(request: NextRequest): Promise<Response> {
      const userId = await dependencies.authenticate(request)
      if (!userId) return jsonError(401, 'Unauthorized')
      const tasks = await dependencies.repository.listOwnedTasks(userId)
      return Response.json({
        tasks: tasks.map(taskListItem),
      })
    },

    async library(request: NextRequest): Promise<Response> {
      const userId = await dependencies.authenticate(request)
      if (!userId) return jsonError(401, 'Unauthorized')
      const tasks = await dependencies.repository.listOwnedTasks(userId)
      const artifactTasks = tasks.filter((task) => task.latestArtifactKey)
      const taskIds = artifactTasks.map((task) => task.id)
      const builds = dependencies.repository.listBuildsForTasks
        ? await dependencies.repository.listBuildsForTasks(taskIds)
        : (await Promise.all(taskIds.map((taskId) => dependencies.repository.listBuilds(taskId)))).flat()
      const buildsByTask = new Map<string, PlayableBuildRecord[]>()
      for (const build of builds) {
        const taskBuilds = buildsByTask.get(build.taskId) ?? []
        taskBuilds.push(build)
        buildsByTask.set(build.taskId, taskBuilds)
      }
      const taskItems = tasks.map(taskListItem)
      const versions = artifactTasks.flatMap((task) => {
        let successfulVersion = 0
        return (buildsByTask.get(task.id) ?? []).flatMap((build) => {
          if (build.status !== 'succeeded') return []
          const version = ++successfulVersion
          const delivery = build.confirmation.delivery
          const deliveryProfile = getDeliveryProfile(deliveryProfileIdFor(delivery))
          return [
            {
              id: build.id,
              taskId: task.id,
              status: build.status,
              version,
              current: Boolean(build.artifactKey && build.artifactKey === task.latestArtifactKey),
              confirmation: sanitizeConfirmation(build.confirmation),
              delivery: {
                label: deliveryProfile.label,
                logicalWidth: delivery.logicalWidth,
                logicalHeight: delivery.logicalHeight,
                output: delivery.output,
              },
              validation: safeValidationSummary(build.validation, delivery),
              createdAt: build.createdAt.toISOString(),
              completedAt: build.completedAt?.toISOString() ?? null,
            },
          ]
        })
      })
      versions.sort(
        (left, right) =>
          new Date(right.completedAt ?? right.createdAt).getTime() -
          new Date(left.completedAt ?? left.createdAt).getTime(),
      )
      return Response.json({ tasks: taskItems, versions }, { headers: { 'Cache-Control': 'private, no-store' } })
    },

    async create(request: NextRequest): Promise<Response> {
      const userId = await dependencies.authenticate(request)
      if (!userId) return jsonError(401, 'Unauthorized')
      const body = (await request.json().catch(() => undefined)) as
        | { prompt?: unknown; sourceTemplateId?: unknown }
        | undefined
      if (typeof body?.prompt !== 'string' || !body.prompt.trim()) return jsonError(400, 'Invalid request')

      if (body.sourceTemplateId !== undefined && !sourceTemplateIds.includes(body.sourceTemplateId as SourceTemplateId))
        return jsonError(400, 'Invalid template')
      const task = await dependencies.repository.createTask({
        id: dependencies.generateId(),
        userId,
        prompt: safeString(body.prompt.trim()),
        ...(body.sourceTemplateId ? { sourceTemplateId: body.sourceTemplateId as SourceTemplateId } : {}),
      })
      return Response.json({ task: { id: task.id, phase: task.phase } }, { status: 201 })
    },

    async rename(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const body = (await request.json().catch(() => undefined)) as { title?: unknown } | undefined
      if (typeof body?.title !== 'string') return jsonError(400, 'Invalid request')
      const requestedTitle = body.title.trim()
      if (!requestedTitle || requestedTitle.length > 120) return jsonError(400, 'Invalid request')
      const title = safeString(requestedTitle)
      const renamed = await dependencies.repository.renameOwnedTask(access.task.id, access.userId, title)
      if (!renamed) return jsonError(404, 'Not found')
      return Response.json({ task: { id: access.task.id, title } })
    },

    async remove(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const removed = await dependencies.repository.deleteOwnedTask(access.task.id, access.userId)
      if (!removed) return jsonError(404, 'Not found')
      return new Response(null, { status: 204 })
    },

    async message(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const body = (await request.json().catch(() => undefined)) as
        | { message?: unknown; attachmentIds?: unknown; referenceSelection?: unknown }
        | undefined
      if (typeof body?.message !== 'string' || !body.message.trim()) return jsonError(400, 'Invalid request')
      if (
        body.attachmentIds !== undefined &&
        (!Array.isArray(body.attachmentIds) ||
          body.attachmentIds.length > 10 ||
          body.attachmentIds.some((assetId) => typeof assetId !== 'string'))
      ) {
        return jsonError(400, 'Invalid request')
      }
      const attachedAssetIds = [...new Set((body.attachmentIds ?? []) as string[])]
      const attachedAssets = await Promise.all(
        attachedAssetIds.map((assetId) =>
          dependencies.repository.findOwnedAsset(access.task.id, access.userId, assetId),
        ),
      )
      if (attachedAssets.some((asset) => !asset)) return jsonError(400, 'Invalid request')
      if (
        !['draft', 'awaiting_confirmation', 'awaiting_revision_confirmation', 'ready', 'failed'].includes(
          access.task.phase,
        )
      ) {
        return jsonError(409, 'Task phase conflict')
      }
      const apiKey = await dependencies.readApiKey(request, access.userId)
      if (!apiKey) return jsonError(503, 'AI service unavailable')
      const message = body.message.trim()
      let referenceSelection: ResolvedReferenceSelection | undefined
      if (body.referenceSelection !== undefined) {
        const parsedSelection = referenceSelectionInputSchema.safeParse(body.referenceSelection)
        if (!parsedSelection.success || !dependencies.repository.saveReferenceSelection) {
          return jsonError(400, 'Invalid reference selection')
        }
        referenceSelection = await dependencies.repository.saveReferenceSelection({
          id: dependencies.generateId(),
          taskId: access.task.id,
          userId: access.userId,
          selection: parsedSelection.data,
        })
        if (!referenceSelection) return jsonError(400, 'Invalid reference selection')
        await dependencies.repository.appendEvent({
          taskId: access.task.id,
          type: 'research_adopted',
          message: 'Market research direction adopted',
        })
      }

      const encoder = new TextEncoder()
      let cancelled = false
      let stopKeepalive: () => void = () => undefined
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enqueue = (event: unknown): boolean => {
            if (cancelled) return false
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
              return true
            } catch {
              cancelled = true
              return false
            }
          }
          const close = () => {
            if (cancelled) return
            try {
              controller.close()
            } catch {
              cancelled = true
            }
          }
          const processing = (async () => {
            const keepalive = setInterval(
              () => enqueue({ type: 'keepalive' }),
              dependencies.requirementStreamKeepaliveMs ?? 15_000,
            )
            stopKeepalive = () => clearInterval(keepalive)
            const prompt = safeString(message, [apiKey])
            // 每个请求单独收集，不能让工具后的新摘要覆盖本轮前面的公开摘要。
            let reasoningHistory: string | undefined
            let stage: RequirementProcessingStage = 'context_load'
            try {
              if (!enqueue({ type: 'started' })) return
              const [history, assets, gameplayBlueprint, builds] = await Promise.all([
                dependencies.repository.listMessages(access.task.id),
                dependencies.repository.listAssets(access.task.id, access.userId),
                gameplayBlueprintDocumentFor(access.task),
                dependencies.repository.listBuilds(access.task.id),
              ])
              stage = 'user_message_store'
              await dependencies.repository.appendMessage(access.task.id, 'user', prompt)
              stage = 'agent_reply'
              const referenceToolCache = new Map<string, unknown>()
              // Only the image tool is budgeted. Reading a stored blueprint
              // costs nothing, so capping the video tool would only stop the
              // agent from re-checking an analysis that finished mid-turn.
              const referenceToolBudget = { imagesExecuted: false }
              const agentReply = await dependencies.agent.proposeConfirmation(
                {
                  taskId: access.task.id,
                  prompt,
                  apiKey,
                  history: history.map((turn) => ({
                    role: turn.role === 'agent' ? 'assistant' : 'user',
                    content: conversationContent(turn, [apiKey]),
                  })),
                  confirmation: access.task.confirmation
                    ? sanitizeConfirmation(access.task.confirmation, [apiKey])
                    : null,
                  brief: access.task.requirementBrief
                    ? sanitizeRequirementBrief(access.task.requirementBrief, [apiKey])
                    : null,
                  assets: assets.map(safeAsset),
                  attachedAssetIds,
                  hasArtifact: Boolean(access.task.latestArtifactKey),
                  pendingRevision: access.task.pendingRevision
                    ? sanitizeRevisionProposal(access.task.pendingRevision, [apiKey])
                    : null,
                  gameplayBlueprint,
                  // Drafts come back without an asset id and are bound to the
                  // active video on store, so showing the agent another video's
                  // annotations would let it rebind them to this one.
                  annotations: activeGameplayAnnotations(access.task),
                  referenceSelection,
                },
                {
                  onProgress(progress) {
                    if ('type' in progress) {
                      enqueue(toolProgressEvent(progress.type, progress.toolCall.name))
                      return
                    }
                    const message = progress.message ? safeString(progress.message, [apiKey]) : undefined
                    const reasoning = progress.reasoning ? safeString(progress.reasoning, [apiKey]) : undefined
                    if (!message && !reasoning) return
                    reasoningHistory = mergeReasoning(reasoningHistory, reasoning)
                    enqueue({ type: 'assistant_progress', message, reasoning: reasoningHistory })
                  },
                  executeTool: (call, toolOptions) =>
                    executeRequirementAnalysisTool({
                      call,
                      task: access.task,
                      userId: access.userId,
                      apiKey,
                      allowedAssetIds: new Set(attachedAssetIds),
                      cache: referenceToolCache,
                      budget: referenceToolBudget,
                      abortSignal: toolOptions?.abortSignal,
                      onResearchProgress(stage) {
                        enqueue({ type: 'research_progress', stage, message: RESEARCH_PROGRESS_COPY[stage] })
                      },
                    }),
                },
              )
              if (cancelled) return
              stage = 'reply_validation'
              const parsedReply = playableAgentReplySchema.parse(agentReply)
              if (containsExactSecret(JSON.stringify(parsedReply), apiKey)) {
                throw new Error('Agent reply contains a credential')
              }
              const validatedReply = sanitizeAgentReply(parsedReply, [apiKey])
              validatedReply.reasoning =
                mergeReasoning(reasoningHistory, validatedReply.reasoning) ?? validatedReply.reasoning
              if (validatedReply.kind === 'research') {
                stage = 'agent_message_store'
                await dependencies.repository.appendMessage(access.task.id, 'agent', JSON.stringify(validatedReply))
                await dependencies.repository.appendEvent({
                  taskId: access.task.id,
                  type: 'research_completed',
                  message: 'Market research completed',
                })
                enqueue({
                  type: 'research',
                  message: validatedReply.message,
                  reasoning: validatedReply.reasoning,
                  research: validatedReply.research,
                })
                return
              }
              const fallbackBrief =
                validatedReply.kind === 'informational'
                  ? (access.task.requirementBrief ?? createRequirementBrief())
                  : (access.task.requirementBrief ?? createRequirementBrief(access.task.prompt))
              const nextBrief = sanitizeRequirementBrief(validatedReply.brief ?? fallbackBrief, [apiKey])
              const templateId = selectedSourceTemplate(access.task)
              delete nextBrief.sourceTemplateId
              if (templateId !== undefined) nextBrief.sourceTemplateId = templateId
              if (validatedReply.annotations) {
                stage = 'annotation_store'
                await storeGameplayAnnotations(access.task, access.userId, validatedReply.annotations)
                // The stored list, with ids, rather than the reply's drafts: it
                // is what the user deletes from.
                enqueue({ type: 'annotations', annotations: activeGameplayAnnotations(access.task) })
              }
              stage = 'brief_store'
              const briefUpdated = await dependencies.repository.updateRequirementBrief(
                access.task.id,
                access.userId,
                nextBrief,
              )
              if (!briefUpdated) throw new Error('Task phase conflict')
              access.task.requirementBrief = nextBrief
              // Checked here rather than in the background job so a turn that
              // owes no comparison schedules nothing at all.
              const analysisAfterBrief = await readCurrentAnalysis(
                access.task,
                access.task.activeReferenceVideoAssetId,
              ).catch(() => undefined)
              if (analysisAfterBrief?.intentPending) scheduleIntentReconciliation(access.task.id, access.userId)
              for (const tool of validatedReply.tools ?? []) {
                if (!enqueue({ type: 'tool_completed', tool })) return
              }
              if (validatedReply.kind === 'confirmation' || validatedReply.kind === 'revision') {
                validatedReply.confirmation = bindSourceTemplate(validatedReply.confirmation, templateId)
              }
              const serialized = JSON.stringify(validatedReply)
              stage = 'agent_message_store'
              await dependencies.repository.appendMessage(access.task.id, 'agent', serialized)
              if (validatedReply.kind === 'informational') {
                enqueue({
                  type: 'informational',
                  message: validatedReply.message,
                  reasoning: validatedReply.reasoning,
                  brief: nextBrief,
                  tools: validatedReply.tools ?? [],
                })
                return
              }
              if (validatedReply.kind === 'clarification') {
                stage = 'phase_transition'
                const transitioned = access.task.latestArtifactKey
                  ? await dependencies.repository.clearPendingRevision(access.task.id, access.userId)
                  : await dependencies.repository.setDraft(access.task.id, access.userId)
                if (!transitioned) throw new Error('Task phase conflict')
                if (validatedReply.tools?.includes('offer_market_research')) {
                  await dependencies.repository.appendEvent({
                    taskId: access.task.id,
                    type: 'research_suggested',
                    message: 'Market research suggested',
                  })
                }
                await dependencies.repository.appendEvent({
                  taskId: access.task.id,
                  type: 'clarification_requested',
                  phase: access.task.latestArtifactKey ? 'ready' : 'draft',
                  message: 'Playable requirements need clarification',
                })
                enqueue({
                  type: 'clarification',
                  message: validatedReply.message,
                  reasoning: validatedReply.reasoning,
                  options: validatedReply.options,
                  request: validatedReply.request,
                  brief: nextBrief,
                  tools: validatedReply.tools ?? [],
                })
                return
              }
              const validated = bindSourceTemplate(validatedReply.confirmation, selectedSourceTemplate(access.task))
              stage = 'phase_transition'
              if (validatedReply.kind === 'revision') {
                if (!access.task.latestArtifactKey) throw new Error('Task phase conflict')
                const revision = resolveRevisionProposal({
                  plan: validatedReply.revision,
                  builds,
                  latestArtifactKey: access.task.latestArtifactKey,
                  id: dependencies.generateId(),
                })
                const transitioned = await dependencies.repository.setAwaitingRevision(
                  access.task.id,
                  access.userId,
                  validated,
                  revision,
                )
                if (!transitioned) throw new Error('Task phase conflict')
                await dependencies.repository.appendEvent({
                  taskId: access.task.id,
                  type: 'revision_proposed',
                  phase: 'awaiting_revision_confirmation',
                  message: 'Playable revision is ready',
                })
                enqueue({
                  type: 'revision',
                  message: validatedReply.message,
                  reasoning: validatedReply.reasoning,
                  confirmation: validated,
                  revision,
                  brief: nextBrief,
                  tools: validatedReply.tools ?? [],
                })
                return
              }
              const transitioned = await dependencies.repository.setAwaitingConfirmation(
                access.task.id,
                access.userId,
                validated,
              )
              if (!transitioned) throw new Error('Task phase conflict')
              await dependencies.repository.appendEvent({
                taskId: access.task.id,
                type: 'confirmation_proposed',
                phase: 'awaiting_confirmation',
                message: 'Confirmation is ready',
              })
              enqueue({
                type: 'confirmation',
                message: validatedReply.message,
                reasoning: validatedReply.reasoning,
                confirmation: validated,
                brief: nextBrief,
                tools: validatedReply.tools ?? [],
              })
            } catch (cause) {
              if (cause instanceof PlayableAgentError) {
                logRequirementFailure(cause)
                enqueue({ type: 'error', message: requirementFailureMessage(cause) })
              } else {
                logRequirementStageFailure(stage)
                enqueue({ type: 'error', message: requirementStageFailureMessage(stage) })
              }
            } finally {
              stopKeepalive()
              close()
            }
          })()
          void processing.catch(() => undefined)
        },
        async cancel() {
          cancelled = true
          stopKeepalive()
          await dependencies.agent.cancel(access.task.id).catch(() => undefined)
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    },

    async analysis(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      if (request.method === 'GET') {
        const current = await readCurrentAnalysis(access.task, access.task.activeReferenceVideoAssetId)
        return Response.json(
          { analysis: safeVideoAnalysis(current) },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
      if (request.method !== 'POST') return jsonError(405, 'Method not allowed')
      // The composition root leaves this undefined when no Gemini key is
      // configured. A missing key used to surface only as a failed run rather
      // than as an honest "analysis is unavailable".
      if (!dependencies.videoAnalyst) return jsonError(503, 'Video analysis is unavailable')

      const body = (await request.json().catch(() => undefined)) as { assetId?: unknown; rerun?: unknown } | undefined
      // An explicit re-run is the only way past a succeeded analysis. Without it
      // a result that came back degraded, or simply wrong, would be final.
      const rerun = body?.rerun === true
      const assets = await dependencies.repository.listAssets(access.task.id, access.userId)
      const activeId = access.task.activeReferenceVideoAssetId
      // Callers must name the video. Picking the newest upload implicitly used
      // to be fine when analysis only ran on send; now that upload triggers it,
      // two uploads in quick succession would both resolve to the same asset.
      const requestedId = typeof body?.assetId === 'string' ? body.assetId : activeId
      if (!requestedId) return jsonError(404, 'Reference video not found')
      const video = assets.find((asset) => asset.id === requestedId && asset.slot === 'referenceVideo')
      if (!video) return jsonError(404, 'Reference video not found')
      if (activeId && video.id !== activeId) return jsonError(409, 'Reference video is not the active one')
      if (!activeId) await dependencies.repository.setActiveReferenceVideo(access.task.id, access.userId, video.id)

      const current = await readCurrentAnalysis(access.task, video.id)
      const latest = current?.latest
      if (latest && latest.status !== 'failed' && !(rerun && latest.status === 'succeeded')) {
        return Response.json(
          { analysis: safeVideoAnalysis(current) },
          { status: latest.status === 'succeeded' ? 200 : 202 },
        )
      }
      const claim = await claimVideoAnalysis(access.task.id, video.id, dependencies.videoAnalyst.model, rerun)
      const analysis = claim.analysis
      // The previous blueprint rides along with the new attempt's status, so a
      // re-run shows as "in progress" without the card going blank.
      const claimedView: CurrentVideoAnalysis = {
        latest: analysis,
        source: analysis.status === 'succeeded' ? analysis : (current?.source ?? current?.latest),
        intentPending: false,
      }
      if (claimedView.source?.status !== 'succeeded') claimedView.source = undefined
      if (!claim.claimed) {
        return Response.json(
          { analysis: safeVideoAnalysis(claimedView) },
          { status: analysis.status === 'succeeded' ? 200 : 202 },
        )
      }
      await dependencies.repository.appendEvent({
        taskId: access.task.id,
        type: 'video_gameplay_analysis_queued',
        message: 'Reference video analysis queued',
      })
      try {
        dependencies.schedule(async () => {
          await runVideoAnalysis({
            task: access.task,
            asset: video,
            analysis,
            repository: dependencies.repository,
            artifactStore: dependencies.artifactStore,
            analyst: dependencies.videoAnalyst!,
            abortSignal: AbortSignal.timeout(VIDEO_ANALYSIS_BUDGET_MS),
          })
          // Covers describing while the video was still being analysed: the
          // run used the intent current when it started, and the brief may
          // have moved on since.
          await reconcileIntentDivergence(access.task.id, access.userId).catch(() => {
            console.error('Intent divergence reconciliation failed')
          })
        })
      } catch {
        await dependencies.repository.failVideoAnalysis(analysis.id, 'schedule_failed')
        return jsonError(500, 'Unable to schedule video analysis')
      }
      return Response.json({ analysis: safeVideoAnalysis(claimedView) }, { status: 202 })
    },

    /**
     * The always-visible annotation list reads and deletes through here. It is
     * the only defence against the agent silently dropping an annotation when
     * it resends the list, so the user must be able to see and prune it
     * without going through the agent.
     */
    async annotations(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      if (request.method === 'DELETE') {
        const id = request.nextUrl.searchParams.get('id')
        if (!id) return jsonError(400, 'Invalid request')
        if (!access.task.gameplayAnnotations.some((annotation) => annotation.id === id)) {
          return jsonError(404, 'Annotation not found')
        }
        const remaining = access.task.gameplayAnnotations.filter((annotation) => annotation.id !== id)
        const updated = await dependencies.repository.updateGameplayAnnotations(
          access.task.id,
          access.userId,
          remaining,
        )
        if (!updated) return jsonError(404, 'Not found')
        access.task.gameplayAnnotations = remaining
      } else if (request.method !== 'GET') {
        return jsonError(405, 'Method not allowed')
      }
      return Response.json(
        { annotations: activeGameplayAnnotations(access.task) },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    },

    async confirm(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const body = (await request.json().catch(() => undefined)) as
        | { confirmation?: unknown; revisionId?: unknown }
        | undefined
      let revision =
        typeof body?.revisionId === 'string' && access.task.pendingRevision?.id === body.revisionId
          ? access.task.pendingRevision
          : undefined
      if (body?.revisionId !== undefined && !revision) return jsonError(409, 'Revision state conflict')
      const parsed = confirmationProposalSchema.safeParse(body?.confirmation)
      if (!parsed.success) return jsonError(400, 'Invalid confirmation')
      const apiKey = await dependencies.readApiKey(request, access.userId)
      if (!apiKey) return jsonError(503, 'AI service unavailable')
      if (containsExactSecret(JSON.stringify(parsed.data), apiKey)) {
        return jsonError(400, 'Invalid confirmation')
      }
      let sanitized: ConfirmationProposal
      try {
        sanitized = sanitizeConfirmation(
          bindSourceTemplate(
            parsed.data,
            parsed.data.sourceTemplateId !== undefined
              ? parsed.data.sourceTemplateId
              : selectedSourceTemplate(access.task),
          ),
        )
      } catch {
        return jsonError(400, 'Invalid confirmation')
      }
      if (Object.values(sanitized.resources).some((resource) => resource.status === '待上传')) {
        return jsonError(400, 'Pending uploads')
      }
      const needsGeneratedMedia = Object.values(sanitized.resources).some((resource) => resource.status === '待生成')
      if (!MAHJONG_PLAYABLE_PLUGIN.capabilities.aiMediaGeneration && needsGeneratedMedia) {
        return jsonError(400, 'AI media generation is not supported')
      }
      const mediaApiKey = needsGeneratedMedia
        ? await (dependencies.readMediaApiKey ?? dependencies.readApiKey)(request, access.userId)
        : undefined
      if (needsGeneratedMedia && !mediaApiKey) {
        return jsonError(503, 'AI media service unavailable')
      }
      const [assets, gameplayBlueprint] = await Promise.all([
        dependencies.repository.listAssets(access.task.id, access.userId),
        gameplayBlueprintDocumentFor(access.task),
      ])
      const uploadedSlots = new Set(assets.map((asset) => asset.slot))
      const missingUpload = Object.entries(sanitized.resources).some(
        ([slot, resource]) => resource.status === '用户上传' && !uploadedSlots.has(slot as PlayableAsset['slot']),
      )
      if (missingUpload) return jsonError(400, 'Uploaded asset missing')

      if (revision?.strategy === 'patch') {
        const baseBuild = await dependencies.repository.findBuild(access.task.id, revision.baseBuildId)
        const previousTemplate = baseBuild?.confirmation.sourceTemplateId ?? baseBuild?.confirmation.mode
        const nextTemplate = sanitized.sourceTemplateId ?? sanitized.mode
        if (baseBuild && previousTemplate !== nextTemplate) {
          revision = { ...revision, strategy: 'regenerate' }
        }
      }

      const buildId = dependencies.generateId()
      const claimed = await dependencies.repository.claimBuild(
        access.task.id,
        access.userId,
        sanitized,
        buildId,
        revision,
      )
      if (!claimed) return jsonError(409, 'Task phase conflict')
      try {
        dependencies.schedule(async () => {
          await settleWithin(
            dependencies.repository.appendEvent({
              taskId: claimed.id,
              type: 'build_started',
              phase: 'building',
              message: 'Playable build started',
            }),
            dependencies.buildStartedEventTimeoutMs ?? DEFAULT_BUILD_STARTED_EVENT_TIMEOUT_MS,
          )
          return runConfirmedBuild({
            task: claimed,
            apiKey,
            mediaApiKey,
            buildId,
            repository: dependencies.repository,
            agent: dependencies.agent,
            artifactStore: dependencies.artifactStore,
            mediaGenerator: dependencies.mediaGenerator,
            buildHeartbeatIntervalMs: dependencies.buildHeartbeatIntervalMs,
            gameplayBlueprint,
          })
        })
      } catch {
        await recordBuildFailure(dependencies.repository, claimed.id, buildId)
        return jsonError(500, 'Unable to schedule build')
      }
      return Response.json({ task: { id: claimed.id, phase: 'building' } }, { status: 202 })
    },

    async events(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      await reconcileStaleBuild(
        dependencies.repository,
        access.task,
        dependencies.staleBuildTimeoutMs ?? DEFAULT_STALE_BUILD_TIMEOUT_MS,
      )
      const latestTask = (await dependencies.repository.findOwnedTask(access.task.id, access.userId)) ?? access.task
      const events = await dependencies.repository.listEvents(access.task.id)
      return Response.json(
        { task: safeTaskState(latestTask), events: events.map(eventJson) },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    },

    async versions(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const builds = await dependencies.repository.listBuilds(access.task.id)
      let successfulVersion = 0
      return Response.json(
        {
          builds: builds.map((build) => {
            const version = build.status === 'succeeded' ? ++successfulVersion : null
            return {
              id: build.id,
              status: build.status,
              version,
              current: Boolean(build.artifactKey && build.artifactKey === access.task.latestArtifactKey),
              validation: safeValidationSummary(build.validation, build.confirmation.delivery),
              createdAt: build.createdAt.toISOString(),
              completedAt: build.completedAt?.toISOString() ?? null,
            }
          }),
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    },

    async review(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const body = (await request.json().catch(() => undefined)) as { action?: unknown } | undefined
      if (body?.action === 'accept') {
        const accepted = await dependencies.repository.acceptArtifact(access.task.id, access.userId)
        if (!accepted) return jsonError(409, 'Task phase conflict')
        await dependencies.repository.appendEvent({
          taskId: access.task.id,
          type: 'review_accepted',
          phase: 'ready',
          message: 'Playable review was accepted',
        })
        return Response.json({ task: { id: access.task.id, phase: 'ready' } })
      }
      if (body?.action === 'revise') {
        const reopened = await dependencies.repository.requestRevision(access.task.id, access.userId)
        if (!reopened) return jsonError(409, 'Task phase conflict')
        await dependencies.repository.appendEvent({
          taskId: access.task.id,
          type: 'revision_requested',
          phase: 'awaiting_confirmation',
          message: 'Playable revision was requested',
        })
        return Response.json({ task: { id: access.task.id, phase: 'awaiting_confirmation' } })
      }
      return jsonError(400, 'Invalid review action')
    },

    async artifact(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const url = new URL(request.url)
      const versionId = url.searchParams.get('version')
      let artifactKey = access.task.latestArtifactKey
      if (versionId) {
        const build = await dependencies.repository.findBuild(access.task.id, versionId)
        if (!build || build.status !== 'succeeded' || !build.artifactKey) return jsonError(404, 'Not found')
        artifactKey = build.artifactKey
      }
      if (!artifactKey) return jsonError(404, 'Not found')
      const kind = url.searchParams.get('kind')
      const download = url.searchParams.get('download') === '1'
      const prefix = artifactKey.slice(0, -'/playable.html'.length)
      const artifacts = {
        playable: {
          key: artifactKey,
          contentType: 'text/html; charset=utf-8',
          filename: 'playable.html',
        },
        config: {
          key: `${prefix}/production-config.json`,
          contentType: 'application/json; charset=utf-8',
          filename: 'production-config.json',
        },
        manifest: {
          key: `${prefix}/asset-manifest.json`,
          contentType: 'application/json; charset=utf-8',
          filename: 'asset-manifest.json',
        },
        validation: {
          key: `${prefix}/validation-report.json`,
          contentType: 'application/json; charset=utf-8',
          filename: 'validation-report.json',
        },
        blueprint: {
          key: `${prefix}/gameplay-blueprint.json`,
          contentType: 'application/json; charset=utf-8',
          filename: 'gameplay-blueprint.json',
        },
      } as const
      if (!kind || !(kind in artifacts)) return jsonError(404, 'Not found')
      if (kind !== 'playable' && !download) return jsonError(404, 'Not found')
      const descriptor = artifacts[kind as keyof typeof artifacts]
      const artifact = await dependencies.artifactStore.get(descriptor.key)
      if (!artifact) return jsonError(404, 'Not found')

      const disposition = download ? 'attachment' : 'inline'
      return new Response(artifact, {
        headers: {
          'Content-Type': descriptor.contentType,
          'Content-Disposition': `${disposition}; filename="${descriptor.filename}"`,
          ...(kind === 'playable'
            ? { 'Content-Security-Policy': disposition === 'inline' ? PREVIEW_CSP : ARTIFACT_CSP }
            : {}),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      })
    },
  }
}
