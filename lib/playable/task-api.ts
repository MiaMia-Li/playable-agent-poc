import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import { PlayableAgentError, type PlayableAgentAdapter, type PlayableBuildAsset } from './playable-agent-adapter'
import {
  confirmationProposalSchema,
  playableAgentReplySchema,
  requirementBriefSchema,
  type ConfirmationProposal,
  type PlayableAgentReply,
  type PlayableTaskPhase,
  type RequirementBrief,
} from './schemas'
import { redactSecrets } from './redact'
import { safeAsset, type PlayableAsset } from './task-assets'
import { generatePlayableMediaAssets } from './media-generation'
import { createAssetSourceManifest, createProductionConfig } from './production-contract'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'
import { isPlayableResourceAssetSlot } from './asset-policy'
import { createRequirementBrief } from './requirement-tools'

type RouteContext = { params: Promise<{ taskId: string }> }

export interface PlayableTaskRecord {
  id: string
  userId: string
  prompt: string
  phase: PlayableTaskPhase
  requirementBrief: RequirementBrief | null
  confirmation: ConfirmationProposal | null
  latestArtifactKey: string | null
  latestValidation?: unknown
  title?: string | null
  createdAt?: Date
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

export type PlayableBuildStatus = 'building' | 'failed' | 'succeeded'

export interface PlayableBuildRecord {
  id: string
  taskId: string
  status: PlayableBuildStatus
  confirmation: ConfirmationProposal
  artifactKey: string | null
  validation?: unknown
  createdAt: Date
  completedAt?: Date | null
}

export interface PlayableTaskRepository {
  createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord>
  findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined>
  appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void>
  listMessages(taskId: string): Promise<PlayableTaskMessageRecord[]>
  updateRequirementBrief(taskId: string, userId: string, brief: RequirementBrief): Promise<boolean>
  setDraft(taskId: string, userId: string): Promise<boolean>
  setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean>
  claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
    buildId: string,
  ): Promise<PlayableTaskRecord | undefined>
  compareAndSetPhase(taskId: string, expected: PlayableTaskPhase, next: PlayableTaskPhase): Promise<boolean>
  publishArtifact(
    taskId: string,
    buildId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean>
  acceptArtifact(taskId: string, userId: string): Promise<boolean>
  requestRevision(taskId: string, userId: string): Promise<boolean>
  markFailed(taskId: string, buildId: string): Promise<void>
  listBuilds(taskId: string): Promise<PlayableBuildRecord[]>
  findBuild(taskId: string, buildId: string): Promise<PlayableBuildRecord | undefined>
  appendEvent(event: { taskId: string; type: string; phase?: string; message?: string }): Promise<void>
  listEvents(taskId: string): Promise<PlayableEventRecord[]>
  listOwnedTasks(userId: string): Promise<PlayableTaskRecord[]>
  saveAsset(asset: PlayableAsset): Promise<void>
  listAssets(taskId: string, userId: string): Promise<PlayableAsset[]>
  findOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined>
  deleteOwnedAsset(taskId: string, userId: string, assetId: string): Promise<PlayableAsset | undefined>
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
  mediaGenerator?: MediaGenerator
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

function safeTaskState(task: PlayableTaskRecord) {
  return {
    phase: task.phase,
    hasArtifact: Boolean(task.latestArtifactKey),
    artifactVersion: task.latestArtifactKey?.split('/').at(-2) ?? null,
    requirementBrief: task.requirementBrief ? sanitizeRequirementBrief(task.requirementBrief) : null,
    confirmation: task.phase !== 'draft' && task.confirmation ? sanitizeConfirmation(task.confirmation) : null,
  }
}

const ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'"
const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; sandbox allow-scripts; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
const DEFAULT_BUILD_STARTED_EVENT_TIMEOUT_MS = 1_000

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
  | 'brief_store'
  | 'agent_message_store'
  | 'phase_transition'

function requirementStageFailureMessage(stage: RequirementProcessingStage): string {
  if (stage === 'context_load') return '无法读取任务上下文，请检查数据库连接后重试'
  if (stage === 'user_message_store') return '无法保存你的消息，请检查数据库连接后重试'
  if (stage === 'reply_validation') return 'Agent 返回的需求方案未通过校验，请重试'
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

async function recordBuildFailure(repository: PlayableTaskRepository, taskId: string, buildId: string): Promise<void> {
  await Promise.allSettled([
    repository.markFailed(taskId, buildId),
    repository.appendEvent({
      taskId,
      type: 'build_failed',
      phase: 'failed',
      message: 'Playable build failed',
    }),
  ])
}

type ConfirmedBuildStage = 'confirmation' | 'assets' | 'media' | 'agent' | 'validation' | 'artifact_store' | 'publish'

function logConfirmedBuildFailure(stage: ConfirmedBuildStage): void {
  if (stage === 'confirmation') console.error('Playable build failed during confirmation validation')
  else if (stage === 'assets') console.error('Playable build failed while loading assets')
  else if (stage === 'media') console.error('Playable build failed during media generation')
  else if (stage === 'agent') console.error('Playable build failed during Sandbox agent execution')
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

  let stage: ConfirmedBuildStage = 'confirmation'
  try {
    if (
      containsExactSecret(JSON.stringify(task.confirmation), apiKey) ||
      (mediaApiKey && containsExactSecret(JSON.stringify(task.confirmation), mediaApiKey))
    ) {
      throw new Error('Confirmation contains a credential')
    }
    const sanitizedConfirmation = sanitizeConfirmation(task.confirmation, [
      apiKey,
      ...(mediaApiKey ? [mediaApiKey] : []),
    ])
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
      taskId: task.id,
      apiKey,
      confirmation: sanitizedConfirmation,
      assets,
    })
    stage = 'validation'
    if (!result.validation.passed || Object.values(result.validation.gates).includes('failed')) {
      throw new Error('Playable validation gates failed')
    }
    if (containsExactSecret(result.html, apiKey)) throw new Error('Artifact contains a credential')
    if (redactSecrets(result.html) !== result.html) throw new Error('Artifact contains a credential')
    const validating = await repository.compareAndSetPhase(task.id, 'building', 'validating')
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
  } catch {
    logConfirmedBuildFailure(stage)
    await recordBuildFailure(repository, task.id, buildId)
  }
}

export function createPlayableTaskHandlers(dependencies: HandlerDependencies) {
  return {
    async list(request: NextRequest): Promise<Response> {
      const userId = await dependencies.authenticate(request)
      if (!userId) return jsonError(401, 'Unauthorized')
      const tasks = await dependencies.repository.listOwnedTasks(userId)
      return Response.json({
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title ?? null,
          prompt: safeString(task.prompt),
          ...safeTaskState(task),
          createdAt: task.createdAt?.toISOString() ?? null,
        })),
      })
    },

    async create(request: NextRequest): Promise<Response> {
      const userId = await dependencies.authenticate(request)
      if (!userId) return jsonError(401, 'Unauthorized')
      const body = (await request.json().catch(() => undefined)) as { prompt?: unknown } | undefined
      if (typeof body?.prompt !== 'string' || !body.prompt.trim()) return jsonError(400, 'Invalid request')

      const task = await dependencies.repository.createTask({
        id: dependencies.generateId(),
        userId,
        prompt: safeString(body.prompt.trim()),
      })
      return Response.json({ task: { id: task.id, phase: task.phase } }, { status: 201 })
    },

    async message(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const body = (await request.json().catch(() => undefined)) as { message?: unknown } | undefined
      if (typeof body?.message !== 'string' || !body.message.trim()) return jsonError(400, 'Invalid request')
      if (!['draft', 'awaiting_confirmation', 'ready', 'failed'].includes(access.task.phase)) {
        return jsonError(409, 'Task phase conflict')
      }
      const apiKey = await dependencies.readApiKey(request, access.userId)
      if (!apiKey) return jsonError(428, 'OpenAI key required')
      const message = body.message.trim()

      const encoder = new TextEncoder()
      let cancelled = false
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
            const prompt = safeString(message, [apiKey])
            let stage: RequirementProcessingStage = 'context_load'
            try {
              if (!enqueue({ type: 'started' })) return
              const [history, assets] = await Promise.all([
                dependencies.repository.listMessages(access.task.id),
                dependencies.repository.listAssets(access.task.id, access.userId),
              ])
              stage = 'user_message_store'
              await dependencies.repository.appendMessage(access.task.id, 'user', prompt)
              stage = 'agent_reply'
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
                },
                {
                  onProgress(progress) {
                    const message = progress.message ? safeString(progress.message, [apiKey]) : undefined
                    const reasoning = progress.reasoning ? safeString(progress.reasoning, [apiKey]) : undefined
                    if (!message && !reasoning) return
                    enqueue({ type: 'assistant_progress', message, reasoning })
                  },
                },
              )
              if (cancelled) return
              stage = 'reply_validation'
              const parsedReply = playableAgentReplySchema.parse(agentReply)
              if (containsExactSecret(JSON.stringify(parsedReply), apiKey)) {
                throw new Error('Agent reply contains a credential')
              }
              const validatedReply = sanitizeAgentReply(parsedReply)
              const fallbackBrief =
                validatedReply.kind === 'informational'
                  ? (access.task.requirementBrief ?? createRequirementBrief())
                  : (access.task.requirementBrief ?? createRequirementBrief(access.task.prompt))
              const nextBrief = sanitizeRequirementBrief(validatedReply.brief ?? fallbackBrief, [apiKey])
              stage = 'brief_store'
              const briefUpdated = await dependencies.repository.updateRequirementBrief(
                access.task.id,
                access.userId,
                nextBrief,
              )
              if (!briefUpdated) throw new Error('Task phase conflict')
              for (const tool of validatedReply.tools ?? []) {
                if (!enqueue({ type: 'tool_completed', tool })) return
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
                const transitioned = await dependencies.repository.setDraft(access.task.id, access.userId)
                if (!transitioned) throw new Error('Task phase conflict')
                await dependencies.repository.appendEvent({
                  taskId: access.task.id,
                  type: 'clarification_requested',
                  phase: 'draft',
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
              const validated = validatedReply.confirmation
              stage = 'phase_transition'
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
              close()
            }
          })()
          void processing.catch(() => undefined)
        },
        async cancel() {
          cancelled = true
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

    async confirm(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const body = (await request.json().catch(() => undefined)) as { confirmation?: unknown } | undefined
      const parsed = confirmationProposalSchema.safeParse(body?.confirmation)
      if (!parsed.success) return jsonError(400, 'Invalid confirmation')
      const apiKey = await dependencies.readApiKey(request, access.userId)
      if (!apiKey) return jsonError(428, 'OpenAI key required')
      if (containsExactSecret(JSON.stringify(parsed.data), apiKey)) {
        return jsonError(400, 'Invalid confirmation')
      }
      let sanitized: ConfirmationProposal
      try {
        sanitized = sanitizeConfirmation(parsed.data)
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
        return jsonError(428, 'OpenAI key required for AI media generation')
      }
      const assets = await dependencies.repository.listAssets(access.task.id, access.userId)
      const uploadedSlots = new Set(assets.map((asset) => asset.slot))
      const missingUpload = Object.entries(sanitized.resources).some(
        ([slot, resource]) => resource.status === '用户上传' && !uploadedSlots.has(slot as PlayableAsset['slot']),
      )
      if (missingUpload) return jsonError(400, 'Uploaded asset missing')

      const buildId = dependencies.generateId()
      const claimed = await dependencies.repository.claimBuild(access.task.id, access.userId, sanitized, buildId)
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
      const events = await dependencies.repository.listEvents(access.task.id)
      const latestTask = (await dependencies.repository.findOwnedTask(access.task.id, access.userId)) ?? access.task
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
