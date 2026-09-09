import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toJSONSchema, z } from 'zod'
import type {
  AgentInput,
  AgentReplyOptions,
  BuildResult,
  ConfirmedBuildInput,
  PlayableAgentAdapter,
} from './playable-agent-adapter'
import { confirmationProposalSchema, type PlayableAgentReply } from './schemas'
import { runPlayableBuild } from './sandbox-runner'
import {
  executeRequirementToolPlan,
  playableCapabilitiesForAgent,
  REQUIREMENT_AGENT_INSTRUCTIONS,
  requirementAgentPlanSchema,
} from './requirement-tools'

const DEFAULT_MODEL = 'gpt-5.6-sol'
const DEFAULT_SKILL_ROOT = path.join(process.cwd(), 'skills/mahjong-pair-match-playable')

function codexOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nested]) => (key === 'format' ? [] : [[key, visit(nested)]])),
    )
  }
  return visit(toJSONSchema(schema)) as Record<string, unknown>
}

export function requirementPlanOutputSchema(): Record<string, unknown> {
  return codexOutputSchema(requirementAgentPlanSchema)
}

export interface CodexInvocation {
  workspace: string
  prompt: string
  schema: Record<string, unknown>
  abortSignal?: AbortSignal
  sandbox: 'read-only' | 'workspace-write'
  reasoningEffort: 'low' | 'medium'
  onEvent?: (event: CodexJsonEvent) => void
  images?: string[]
}

interface CodexJsonEvent {
  type?: string
  item?: {
    type?: string
    text?: string
  }
}

type InvokeCodex = (input: CodexInvocation) => Promise<unknown>
type BuildRunner = (input: ConfirmedBuildInput, options: { abortSignal?: AbortSignal }) => Promise<BuildResult>

export interface CodexCliPlayableAgentDependencies {
  invokeCodex?: InvokeCodex
  buildRunner?: BuildRunner
  skillRoot?: string
}

function codexEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV }
  const allowed = ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL'] as const
  for (const key of allowed) {
    const value = process.env[key]
    if (value) environment[key] = value
  }
  return environment
}

export async function invokeCodexCli(input: CodexInvocation): Promise<unknown> {
  const controlRoot = await mkdtemp(path.join(os.tmpdir(), 'playable-codex-control-'))
  const schemaPath = path.join(controlRoot, 'schema.json')
  const outputPath = path.join(controlRoot, 'result.json')
  await writeFile(schemaPath, JSON.stringify(input.schema), 'utf8')

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'codex',
        [
          'exec',
          '--ephemeral',
          '--ignore-user-config',
          '--ignore-rules',
          '--sandbox',
          input.sandbox,
          '--model',
          process.env.PLAYABLE_AGENT_MODEL || DEFAULT_MODEL,
          '--config',
          `model_reasoning_effort="${input.reasoningEffort}"`,
          '--skip-git-repo-check',
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          '--json',
          '--color',
          'never',
          ...(input.images ?? []).flatMap((image) => ['--image', image]),
          '-',
        ],
        {
          cwd: input.workspace,
          env: codexEnvironment(),
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      )
      let stdoutBuffer = ''
      const handleLine = (line: string) => {
        if (!line.trim()) return
        try {
          input.onEvent?.(JSON.parse(line) as CodexJsonEvent)
        } catch {
          // Ignore malformed diagnostic events; the validated output file remains authoritative.
        }
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) handleLine(line)
      })
      const abort = () => child.kill('SIGTERM')
      input.abortSignal?.addEventListener('abort', abort, { once: true })
      child.once('error', () => {
        console.error('Codex CLI process could not start')
        reject(new Error('Codex CLI could not be started'))
      })
      child.once('close', (code) => {
        handleLine(stdoutBuffer)
        input.abortSignal?.removeEventListener('abort', abort)
        if (input.abortSignal?.aborted) {
          console.error('Codex CLI process was cancelled')
          reject(new Error('Codex CLI invocation was cancelled'))
        } else if (code !== 0) {
          console.error('Codex CLI process returned a failure')
          reject(new Error('Codex CLI invocation failed'))
        } else resolve()
      })
      child.stdin.end(input.prompt)
    })
    try {
      return JSON.parse(await readFile(outputPath, 'utf8')) as unknown
    } catch {
      console.error('Codex CLI structured output could not be read')
      throw new Error('Codex CLI structured output is invalid')
    }
  } finally {
    await rm(controlRoot, { recursive: true, force: true })
  }
}

export function createRequirementAgentPrompt(input: AgentInput): string {
  return [
    REQUIREMENT_AGENT_INSTRUCTIONS,
    'Do not inspect workspace files. All available domain data is supplied below.',
    '',
    '<conversation-context>',
    JSON.stringify({
      history: input.history ?? [],
      currentConfirmation: input.confirmation ?? null,
      requirementBrief: input.brief ?? null,
      uploadedAssets: input.assets ?? [],
      gameplayBlueprint: input.gameplayBlueprint ?? null,
      capabilities: playableCapabilitiesForAgent(),
      latestUserMessage: input.prompt,
    }),
    '</conversation-context>',
  ].join('\n')
}

function safeWorkspaceFilename(id: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'asset'
  return `${id}-${safeName}`
}

async function prepareLocalWorkspace(input: ConfirmedBuildInput, skillRoot: string): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'playable-codex-work-'))
  await cp(skillRoot, workspace, { recursive: true })
  await writeFile(path.join(workspace, 'confirmed-config.json'), JSON.stringify(input.confirmation, null, 2), 'utf8')
  if (input.gameplayBlueprint) {
    await writeFile(
      path.join(workspace, 'gameplay-blueprint.json'),
      JSON.stringify(input.gameplayBlueprint, null, 2),
      'utf8',
    )
  }

  const manifest = {
    assets: [] as Array<Record<string, unknown>>,
    entrypoint: 'playable.html' as const,
  }
  for (const asset of input.assets ?? []) {
    const workspacePath = path.join('user-assets', asset.slot, safeWorkspaceFilename(asset.id, asset.filename))
    const absolutePath = path.join(workspace, workspacePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, asset.bytes)
    const { bytes: _bytes, ...metadata } = asset
    void _bytes
    manifest.assets.push({ ...metadata, workspacePath })
  }
  await writeFile(path.join(workspace, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return workspace
}

const completionSchema = z.strictObject({ completed: z.literal(true) })

export class CodexCliPlayableAgent implements PlayableAgentAdapter {
  private readonly invokeCodex: InvokeCodex
  private readonly buildRunner?: BuildRunner
  private readonly skillRoot: string
  private readonly activeTasks = new Map<string, AbortController>()

  constructor(dependencies: CodexCliPlayableAgentDependencies = {}) {
    this.invokeCodex = dependencies.invokeCodex ?? invokeCodexCli
    this.buildRunner = dependencies.buildRunner
    this.skillRoot = dependencies.skillRoot ?? DEFAULT_SKILL_ROOT
  }

  async proposeConfirmation(input: AgentInput, options?: AgentReplyOptions): Promise<PlayableAgentReply> {
    const controller = new AbortController()
    this.activeTasks.set(input.taskId, controller)
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'playable-codex-proposal-'))
    try {
      const result = await this.invokeCodex({
        workspace,
        sandbox: 'read-only',
        reasoningEffort: 'low',
        abortSignal: controller.signal,
        schema: requirementPlanOutputSchema(),
        prompt: createRequirementAgentPrompt(input),
        onEvent(event) {
          if (event.type !== 'item.completed' || !event.item?.text) return
          if (event.item.type === 'reasoning') {
            options?.onProgress?.({ reasoning: event.item.text })
            return
          }
          if (event.item.type !== 'agent_message') return
          try {
            const partial = JSON.parse(event.item.text) as { message?: unknown; reasoning?: unknown }
            options?.onProgress?.({
              message: typeof partial.message === 'string' ? partial.message : undefined,
              reasoning: typeof partial.reasoning === 'string' ? partial.reasoning : undefined,
            })
          } catch {
            // The output file is parsed and validated below.
          }
        },
      })
      try {
        return executeRequirementToolPlan({
          plan: result,
          currentBrief: input.brief,
          prompt: input.prompt,
          assets: input.assets,
        }).reply
      } catch {
        console.error('Codex CLI requirement plan did not pass validation')
        throw new Error('Codex CLI requirement plan is invalid')
      }
    } finally {
      this.activeTasks.delete(input.taskId)
      await rm(workspace, { recursive: true, force: true })
    }
  }

  async build(input: ConfirmedBuildInput): Promise<BuildResult> {
    confirmationProposalSchema.parse(input.confirmation)
    const controller = new AbortController()
    this.activeTasks.set(input.taskId, controller)
    let workspace: string | undefined
    try {
      workspace = await prepareLocalWorkspace(input, this.skillRoot)
      const completion = await this.invokeCodex({
        workspace,
        sandbox: 'workspace-write',
        reasoningEffort: 'medium',
        abortSignal: controller.signal,
        schema: codexOutputSchema(completionSchema),
        prompt:
          input.confirmation.routing.match === 'freeform'
            ? [
                'Read SKILL.md, confirmed-config.json, asset-manifest.json, and gameplay-blueprint.json when present.',
                'The confirmed route is freeform because no registered template can express the requested core gameplay.',
                'Create the requested game directly in output.html. The selected mode is only a scaffold and must not override the confirmed gameplay.',
                'Produce one offline responsive Canvas HTML under 5 MiB with no external resources.',
                'Start muted, make the first interaction gameplay-only, support the playable:set-muted parent message, and expose window.__PLAYABLE__.',
                'Use uploaded files only for their declared resource slots.',
                'Do not modify confirmed-config.json or asset-manifest.json.',
                'Do not access files outside this workspace or make network requests.',
                'Run the freeform validation command. When it passes, return {"completed":true}.',
              ].join('\n')
            : input.confirmation.routing.match === 'approximate'
              ? [
                  'Read SKILL.md, confirmed-config.json, asset-manifest.json, and gameplay-blueprint.json when present.',
                  'The confirmed route is approximate: use the selected registered mode as the working baseline, then implement every confirmed routing difference and gameplay requirement in output.html.',
                  'Run the existing template build first when useful, but do not stop at the unmodified template.',
                  'Preserve the registered mode runtime contract and pass its required behavioral test after adapting the experience.',
                  'Use uploaded files only for their declared resource slots.',
                  'Do not modify confirmed-config.json or asset-manifest.json.',
                  'Do not access files outside this workspace or make network requests.',
                  'When the adapted playable passes, return {"completed":true}.',
                ].join('\n')
              : [
                  'Read SKILL.md, confirmed-config.json, asset-manifest.json, and gameplay-blueprint.json when present.',
                  'Build the approved playable in this workspace and run the required behavioral test.',
                  'Write the final single-file playable to output.html.',
                  'For a registered mode, use its existing template immediately; do not rewrite the large shared runtime.',
                  'Use uploaded files only for their declared resource slots.',
                  'Do not modify confirmed-config.json or asset-manifest.json.',
                  'Do not access files outside this workspace or make network requests.',
                  'When the playable passes, return {"completed":true}.',
                ].join('\n'),
      })
      if (!completionSchema.safeParse(completion).success) {
        console.error('Codex CLI build completion was invalid')
        throw new Error('Codex CLI build completion is invalid')
      }
      console.log('Codex CLI playable workspace completed')
      if (this.buildRunner) return await this.buildRunner(input, { abortSignal: controller.signal })
      const preparedArtifact = new Uint8Array(await readFile(path.join(workspace, 'output.html')))
      console.log('Starting Vercel Sandbox playable validation')
      const buildResult = await runPlayableBuild(input, {
        skillRoot: this.skillRoot,
        abortSignal: controller.signal,
        preparedArtifact,
        executeAgent: async () => {
          console.log('Confirmed configuration loaded in Vercel Sandbox')
        },
        logger: {
          async info(message) {
            if (message === 'Preparing isolated playable workspace') {
              console.log('Preparing Vercel Sandbox workspace')
            } else if (message === 'Running playable agent') {
              console.log('Applying Codex changes in Vercel Sandbox')
            } else if (message === 'Loading prepared playable artifact') {
              console.log('Loading Codex artifact in Vercel Sandbox')
            } else if (message === 'Validating playable behavior') {
              console.log('Running playable behavior test in Vercel Sandbox')
            }
          },
        },
      })
      console.log('Vercel Sandbox playable validation completed')
      return buildResult
    } finally {
      this.activeTasks.delete(input.taskId)
      if (workspace) await rm(workspace, { recursive: true, force: true })
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.activeTasks.get(taskId)?.abort()
  }
}
