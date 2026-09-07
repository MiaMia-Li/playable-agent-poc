import type { NextRequest } from 'next/server'
import type { ArtifactStore } from './artifact-store'
import type { PlayableAgentAdapter } from './playable-agent-adapter'
import { confirmationProposalSchema, type ConfirmationProposal, type PlayableTaskPhase } from './schemas'
import { redactSecrets } from './redact'

type RouteContext = { params: Promise<{ taskId: string }> }

export interface PlayableTaskRecord {
  id: string
  userId: string
  prompt: string
  phase: PlayableTaskPhase
  confirmation: ConfirmationProposal | null
  latestArtifactKey: string | null
  latestValidation?: unknown
}

export interface PlayableEventRecord {
  id: string
  taskId: string
  type: string
  phase?: string
  message?: string
  createdAt: Date
}

export interface PlayableTaskRepository {
  createTask(input: { id: string; userId: string; prompt: string }): Promise<PlayableTaskRecord>
  findOwnedTask(taskId: string, userId: string): Promise<PlayableTaskRecord | undefined>
  appendMessage(taskId: string, role: 'user' | 'agent', content: string): Promise<void>
  setAwaitingConfirmation(taskId: string, userId: string): Promise<boolean>
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
  markFailed(taskId: string): Promise<void>
  appendEvent(event: { taskId: string; type: string; phase?: string; message?: string }): Promise<void>
  listEvents(taskId: string): Promise<PlayableEventRecord[]>
}

export type BackgroundScheduler = (work: () => Promise<void>) => void

interface HandlerDependencies {
  authenticate(request: NextRequest): Promise<string | undefined>
  readApiKey(request: NextRequest, userId: string): Promise<string | undefined>
  repository: PlayableTaskRepository
  agent: PlayableAgentAdapter
  artifactStore: ArtifactStore
  schedule: BackgroundScheduler
  buildStartedEventTimeoutMs?: number
  generateId(): string
}

interface ConfirmedBuildDependencies {
  task: PlayableTaskRecord
  apiKey: string
  buildId: string
  repository: PlayableTaskRepository
  agent: PlayableAgentAdapter
  artifactStore: ArtifactStore
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
  const { task, apiKey, buildId, repository, agent, artifactStore } = dependencies
  if (!task.confirmation) {
    await recordBuildFailure(repository, task.id)
    return
  }

  try {
    if (containsExactSecret(JSON.stringify(task.confirmation), apiKey)) {
      throw new Error('Confirmation contains a credential')
    }
    const sanitizedConfirmation = sanitizeConfirmation(task.confirmation, [apiKey])
    const result = await agent.build({
      taskId: task.id,
      apiKey,
      confirmation: sanitizedConfirmation,
    })
    if (containsExactSecret(result.html, apiKey)) throw new Error('Artifact contains a credential')
    if (redactSecrets(result.html) !== result.html) throw new Error('Artifact contains a credential')
    const validating = await repository.compareAndSetPhase(task.id, 'building', 'validating')
    if (!validating) return

    const prefix = artifactPrefix(task, buildId)
    const playableKey = `${prefix}/playable.html`
    const validationReport = {
      behavior: result.validation.behavior,
      bytes: result.validation.bytes,
    }
    await artifactStore.put(
      `${prefix}/confirmed-config.json`,
      JSON.stringify(sanitizedConfirmation),
      'application/json',
    )
    await artifactStore.put(
      `${prefix}/asset-manifest.json`,
      JSON.stringify({ assets: [], entrypoint: 'playable.html' }),
      'application/json',
    )
    await artifactStore.put(`${prefix}/validation-report.json`, JSON.stringify(validationReport), 'application/json')
    await artifactStore.put(playableKey, result.html, 'text/html; charset=utf-8')

    const published = await repository.publishArtifact(task.id, 'validating', playableKey, validationReport)
    if (!published) {
      await recordBuildFailure(repository, task.id)
      return
    }
    await repository
      .appendEvent({
        taskId: task.id,
        type: 'build_ready',
        phase: 'ready',
        message: 'Playable build is ready',
      })
      .catch(() => undefined)
  } catch {
    await recordBuildFailure(repository, task.id)
  }
}

export function createPlayableTaskHandlers(dependencies: HandlerDependencies) {
  return {
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
              await dependencies.repository.appendMessage(access.task.id, 'user', prompt)
              if (!enqueue({ type: 'started' })) return
              const proposal = await dependencies.agent.proposeConfirmation({
                taskId: access.task.id,
                prompt,
                apiKey,
              })
              if (cancelled) return
              const parsedProposal = confirmationProposalSchema.parse(proposal)
              if (containsExactSecret(JSON.stringify(parsedProposal), apiKey)) {
                throw new Error('Proposal contains a credential')
              }
              const validated = sanitizeConfirmation(parsedProposal)
              const serialized = JSON.stringify(validated)
              await dependencies.repository.appendMessage(access.task.id, 'agent', serialized)
              const transitioned = await dependencies.repository.setAwaitingConfirmation(access.task.id, access.userId)
              if (!transitioned) throw new Error('Task phase conflict')
              await dependencies.repository.appendEvent({
                taskId: access.task.id,
                type: 'confirmation_proposed',
                phase: 'awaiting_confirmation',
                message: 'Confirmation is ready',
              })
              enqueue({ type: 'confirmation', confirmation: validated })
            } catch {
              enqueue({ type: 'error', message: 'Unable to prepare confirmation' })
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
            buildId,
            repository: dependencies.repository,
            agent: dependencies.agent,
            artifactStore: dependencies.artifactStore,
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
      return Response.json({ events: events.map(eventJson) }, { headers: { 'Cache-Control': 'private, no-store' } })
    },

    async artifact(request: NextRequest, context: RouteContext): Promise<Response> {
      const access = await ownedTask(request, context, dependencies)
      if (access instanceof Response) return access
      const url = new URL(request.url)
      if (url.searchParams.get('kind') !== 'playable') return jsonError(404, 'Not found')
      if (!access.task.latestArtifactKey) return jsonError(404, 'Not found')
      const artifact = await dependencies.artifactStore.get(access.task.latestArtifactKey)
      if (!artifact) return jsonError(404, 'Not found')

      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
      return new Response(artifact, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `${disposition}; filename="playable.html"`,
          'Content-Security-Policy': disposition === 'inline' ? PREVIEW_CSP : ARTIFACT_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      })
    },
  }
}
