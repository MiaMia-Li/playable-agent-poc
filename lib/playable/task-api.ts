import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import type { PlayableAgentAdapter, PlayableBuildAsset } from './playable-agent-adapter'
import {
  confirmationProposalSchema,
  playableAgentReplySchema,
  type ConfirmationProposal,
  type PlayableAgentReply,
  type PlayableTaskPhase,
} from './schemas'
import { redactSecrets } from './redact'
import { safeAsset, type PlayableAsset } from './task-assets'
import { generatePlayableMediaAssets } from './media-generation'
import { createAssetSourceManifest, createProductionConfig } from './production-contract'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'
import { isPlayableResourceAssetSlot } from './asset-policy'

type RouteContext = { params: Promise<{ taskId: string }> }

export interface PlayableTaskRecord {
  id: string
  userId: string
  prompt: string
  phase: PlayableTaskPhase
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

export interface PlayableTaskRepository {
  createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord>
  findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined>
  appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void>
  listMessages(taskId: string): Promise<PlayableTaskMessageRecord[]>
  setDraft(taskId: string, userId: string): Promise<boolean>
  setAwaitingConfirmation(taskId: string, userId: string, confirmation: ConfirmationProposal): Promise<boolean>
  claimBuild(
    taskId: string,
    userId: string,
    confirmation: ConfirmationProposal,
  ): Promise<PlayableTaskRecord | undefined>
  compareAndSetPhase(taskId: string, expected: PlayableTaskPhase, next: PlayableTaskPhase): Promise<boolean>
  publishArtifact(
    taskId: string,
    expectedPhase: 'validating',
    artifactKey: string,
    validation: unknown,
  ): Promise<boolean>
  acceptArtifact(taskId: string, userId: string): Promise<boolean>
  requestRevision(taskId: string, userId: string): Promise<boolean>
  markFailed(taskId: string): Promise<void>
  appendEvent(event: { taskId: string; type: string; phase?: string; message?: string }): Promise<void>
  listEvents(taskId: string): Promise<PlayableEventRecord[]>
  listOwnedTasks(userId: string): Promise<PlayableTaskRecord[]>
  saveAsset(asset: PlayableAsset): Promise<void>
  listAssets(taskId: string, userId: string): Promise<PlayableAsset[]>
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

function sanitizeConfirmation(value: ConfirmationProposal, secrets: readonly string[] = []): ConfirmationProposal {
  return confirmationProposalSchema.parse(JSON.parse(redactSecrets(JSON.stringify(value), secrets)))
}

function sanitizeAgentReply(value: PlayableAgentReply, secrets: readonly string[] = []): PlayableAgentReply {
  return playableAgentReplySchema.parse(JSON.parse(redactSecrets(JSON.stringify(value), secrets)))
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

async function recordBuildFailure(repository: PlayableTaskRepository, taskId: string): Promise<void> {
  await Promise.allSettled([
    repository.markFailed(taskId),
    repository.appendEvent({
      taskId,
      type: 'build_failed',
      phase: 'failed',
      message: 'Playable build failed',
    }),
  ])
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
    await recordBuildFailure(repository, task.id)
    return
  }

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
    const mediaGenerator = dependencies.mediaGenerator ?? generatePlayableMediaAssets
    const generatedAssets = needsGeneratedMedia
      ? await mediaGenerator({
          taskId: task.id,
          apiKey: generationApiKey,
          confirmation: sanitizedConfirmation,
        })
      : []
    const assets = [...uploadedAssets, ...generatedAssets]
    const result = await agent.build({
      taskId: task.id,
      apiKey,
      confirmation: sanitizedConfirmation,
      assets,
    })
    if (!result.validation.passed || Object.values(result.validation.gates).includes('failed')) {
      throw new Error('Playable validation gates failed')
    }
    if (containsExactSecret(result.html, apiKey)) throw new Error('Artifact contains a credential')
    if (redactSecrets(result.html) !== result.html) throw new Error('Artifact contains a credential')
    const validating = await repository.compareAndSetPhase(task.id, 'building', 'validating')
    if (!validating) return

    const prefix = artifactPrefix(task, buildId)
    const playableKey = `${prefix}/playable.html`
    const validationReport = result.validation
    const productionConfig = createProductionConfig(sanitizedConfirmation)
    const assetManifest = result.assetManifest ?? createAssetSourceManifest(sanitizedConfirmation, assets)
    console.log('Storing playable artifacts')
    await artifactStore.put(`${prefix}/production-config.json`, JSON.stringify(productionConfig), 'application/json')
    await artifactStore.put(`${prefix}/asset-manifest.json`, JSON.stringify(assetManifest), 'application/json')
    await artifactStore.put(`${prefix}/validation-report.json`, JSON.stringify(validationReport), 'application/json')
    await artifactStore.put(playableKey, result.html, 'text/html; charset=utf-8')

    const published = await repository.publishArtifact(task.id, 'validating', playableKey, validationReport)
    if (!published) {
      await recordBuildFailure(repository, task.id)
      return
    }
    console.log('Playable artifacts published')
    await repository
      .appendEvent({
        taskId: task.id,
        type: 'review_requested',
        phase: 'reviewing',
        message: 'Playable build is ready for review',
      })
      .catch(() => undefined)
  } catch {
    await recordBuildFailure(repository, task.id)
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
      if (!['draft', 'awaiting_confirmation'].includes(access.task.phase)) {
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
            try {
              if (!enqueue({ type: 'started' })) return
              const [history, assets] = await Promise.all([
                dependencies.repository.listMessages(access.task.id),
                dependencies.repository.listAssets(access.task.id, access.userId),
              ])
              await dependencies.repository.appendMessage(access.task.id, 'user', prompt)
              const agentReply = await dependencies.agent.proposeConfirmation({
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
                assets: assets.map(safeAsset),
              })
              if (cancelled) return
              const parsedReply = playableAgentReplySchema.parse(agentReply)
              if (containsExactSecret(JSON.stringify(parsedReply), apiKey)) {
                throw new Error('Agent reply contains a credential')
              }
              const validatedReply = sanitizeAgentReply(parsedReply)
              const serialized = JSON.stringify(validatedReply)
              await dependencies.repository.appendMessage(access.task.id, 'agent', serialized)
              if (validatedReply.kind === 'clarification') {
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
                })
                return
              }
              const validated = validatedReply.confirmation
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
              })
            } catch {
              enqueue({ type: 'error', message: '助手暂时无法继续整理需求，请重试' })
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

      const claimed = await dependencies.repository.claimBuild(access.task.id, access.userId, sanitized)
      if (!claimed) return jsonError(409, 'Task phase conflict')
      const buildId = dependencies.generateId()
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
        await recordBuildFailure(dependencies.repository, claimed.id)
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
      if (!access.task.latestArtifactKey) return jsonError(404, 'Not found')
      const kind = url.searchParams.get('kind')
      const download = url.searchParams.get('download') === '1'
      if (download && access.task.phase !== 'ready') return jsonError(409, 'Artifact requires review approval')
      const prefix = access.task.latestArtifactKey.slice(0, -'/playable.html'.length)
      const artifacts = {
        playable: {
          key: access.task.latestArtifactKey,
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
