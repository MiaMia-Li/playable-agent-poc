import { readBuildSkillFiles } from './build-skill'
import { buildValidationCommand, usesPerspectiveTemplate } from './build-template-policy'
import path from 'node:path'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import type { BuildResult, ConfirmedBuildInput, PlayableAssetManifest } from './playable-agent-adapter'
import { createExternalErrorLoggingFetch, logExternalRequestError } from './external-request-logging'
import { createAssetSourceManifest, createValidationReport } from './production-contract'
import { redactSecrets } from './redact'
import { confirmationProposalSchema } from './schemas'
import { OPENROUTER_BASE_URL } from './shared-ai-key'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'
import { PLAYABLE_SANDBOX_TOOLS_VERSION, PLAYABLE_TOOLS_CHECK } from './sandbox-tools'

interface SandboxCommandOptions {
  command: string
  workingDirectory?: string
  env?: Record<string, string>
  abortSignal?: AbortSignal
}

interface SandboxCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface PlayableSandbox {
  readonly defaultWorkingDirectory: string
  writeBinaryFile(options: { path: string; content: Uint8Array; abortSignal?: AbortSignal }): PromiseLike<void>
  writeTextFile(options: { path: string; content: string; abortSignal?: AbortSignal }): PromiseLike<void>
  readBinaryFile(options: { path: string; abortSignal?: AbortSignal }): PromiseLike<Uint8Array | null>
  readTextFile(options: { path: string; abortSignal?: AbortSignal }): PromiseLike<string | null>
  run(options: SandboxCommandOptions): PromiseLike<SandboxCommandResult>
  destroy(): PromiseLike<void>
}

interface BuildLogger {
  info(message: string): PromiseLike<void>
}

export interface ExecuteAgentInput {
  authEnvironment: Readonly<Record<'CODEX_API_KEY' | 'OPENAI_BASE_URL', string>>
  sandbox: PlayableSandbox
  workspace: string
  taskId: string
  abortSignal?: AbortSignal
}

export interface RunPlayableBuildDependencies {
  executeAgent: (input: ExecuteAgentInput) => PromiseLike<unknown>
  createSandbox?: (taskId: string, abortSignal?: AbortSignal) => PromiseLike<PlayableSandbox>
  logger?: BuildLogger
  skillRoot?: string
  abortSignal?: AbortSignal
  preparedArtifact?: Uint8Array
}

export type PlayableBuildExecutionStage =
  | 'sandbox_create'
  | 'workspace'
  | 'agent'
  | 'integrity'
  | 'artifact_build'
  | 'validation'
  | 'artifact_check'

export class PlayableBuildExecutionError extends Error {
  constructor(
    readonly stage: PlayableBuildExecutionStage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'Playable build execution failed', { cause })
    this.name = 'PlayableBuildExecutionError'
  }
}

interface SkillFile {
  relativePath: string
  content: Uint8Array
}

function safeWorkspaceFilename(id: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'asset'
  return `${id}-${safeName}`
}

function hasExternalResourceReference(html: string): boolean {
  const isEmbeddedReference = (value: string) => /^(?:data:|blob:|#)/i.test(value.trim())
  const resourceAttributes =
    /<(?:img|audio|video|source|script|link|iframe|object)\b[^>]*\b(?:src|href|poster|data|srcset)\s*=\s*["']([^"']+)["']/gi
  for (const match of html.matchAll(resourceAttributes)) {
    if (!isEmbeddedReference(match[1])) return true
  }

  const htmlWithoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  const cssResources = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
  for (const match of htmlWithoutScripts.matchAll(cssResources)) {
    if (!isEmbeddedReference(match[1])) return true
  }
  return false
}

function hasResponsiveViewport(html: string): boolean {
  return /<meta\s+name=["']viewport["'][^>]*width=device-width/i.test(html) && /<canvas\b/i.test(html)
}

function assertRegisteredTemplateContract(confirmation: ConfirmedBuildInput['confirmation'], html: string): void {
  if (!usesPerspectiveTemplate(confirmation)) return
  const requiredTokens = [
    'data-playable-template="perspective_3d"',
    `data-template-version="${MAHJONG_PLAYABLE_PLUGIN.version}"`,
    "mode:'perspective_3d'",
    "renderer:'Three.js WebGL'",
    'LAYERS=8',
  ]
  if (requiredTokens.some((token) => !html.includes(token))) {
    throw new Error('Perspective 3D template contract is missing')
  }
}

export async function createPlayableSandbox(taskId: string, abortSignal?: AbortSignal): Promise<PlayableSandbox> {
  const explicitCredentials =
    process.env.SANDBOX_VERCEL_TOKEN && process.env.SANDBOX_VERCEL_TEAM_ID && process.env.SANDBOX_VERCEL_PROJECT_ID
      ? {
          token: process.env.SANDBOX_VERCEL_TOKEN,
          teamId: process.env.SANDBOX_VERCEL_TEAM_ID,
          projectId: process.env.SANDBOX_VERCEL_PROJECT_ID,
        }
      : {}
  const snapshotId = process.env.PLAYABLE_SANDBOX_SNAPSHOT_ID?.trim()
  const provider = createVercelSandbox({
    // 快照自带系统环境，不能同时传 runtime；未配置快照时保留原来的 Node 24 路径。
    ...(snapshotId ? { source: { type: 'snapshot' as const, snapshotId } } : { runtime: 'node24' }),
    // 每个任务独立使用快照副本，不把本次素材、凭据和产物保存为下一次任务的环境。
    persistent: false,
    // 与确认接口的 30 分钟预算一致，避免 Sandbox 默认期限提前终止 Agent。
    timeout: 30 * 60 * 1000,
    ports: [4000],
    fetch: createExternalErrorLoggingFetch('Vercel Sandbox', [
      process.env.SANDBOX_VERCEL_TOKEN ?? '',
      process.env.SANDBOX_VERCEL_TEAM_ID ?? '',
      process.env.SANDBOX_VERCEL_PROJECT_ID ?? '',
    ]),
    ...explicitCredentials,
  })
  try {
    const sandbox = await provider.createSession({ sessionId: taskId, abortSignal })
    if (snapshotId) {
      try {
        // 仅做轻量就绪检查，不重新安装或启动浏览器；玩法验收仍由后续 Agent 执行。
        const check = await sandbox.run({
          command: PLAYABLE_TOOLS_CHECK,
          env: { PLAYABLE_TOOLS_EXPECTED_VERSION: PLAYABLE_SANDBOX_TOOLS_VERSION },
          abortSignal,
        })
        if (check.exitCode !== 0) throw new Error('Playable sandbox tools are incompatible; rebuild the snapshot')
      } catch (error) {
        // 不兼容时清理副本并报错，不静默退回重复安装，避免掩盖配置问题和构建耗时。
        await Promise.resolve(sandbox.destroy()).catch(() => undefined)
        throw error
      }
    }
    return sandbox
  } catch (error) {
    logExternalRequestError('Vercel Sandbox', error, [
      process.env.SANDBOX_VERCEL_TOKEN ?? '',
      process.env.SANDBOX_VERCEL_TEAM_ID ?? '',
      process.env.SANDBOX_VERCEL_PROJECT_ID ?? '',
    ])
    throw error
  }
}

async function requireSuccessfulCommand(
  sandbox: PlayableSandbox,
  options: SandboxCommandOptions,
  failureMessage: string,
) {
  const result = await sandbox.run(options)
  if (result.exitCode !== 0) throw new Error(failureMessage)
}

async function assertMasterUnchanged(
  sandbox: PlayableSandbox,
  masterRoot: string,
  files: SkillFile[],
  abortSignal?: AbortSignal,
) {
  for (const file of files) {
    const copied = await sandbox.readBinaryFile({
      path: path.join(masterRoot, file.relativePath),
      abortSignal,
    })
    if (copied === null || !Buffer.from(copied).equals(Buffer.from(file.content))) {
      throw new Error('Skill master was modified')
    }
  }
}

export async function runPlayableBuild(
  input: ConfirmedBuildInput,
  dependencies: RunPlayableBuildDependencies,
): Promise<BuildResult> {
  if (typeof dependencies?.executeAgent !== 'function') throw new Error('Agent executor is required')
  if (!input.apiKey.trim()) throw new Error('API key is required')
  input.onActivity?.('preparing')
  const confirmation = confirmationProposalSchema.parse(input.confirmation)
  const freeform = confirmation.routing.match === 'freeform'
  const serializedConfirmation = JSON.stringify(confirmation, null, 2)

  dependencies.abortSignal?.throwIfAborted()
  const skillFiles = await readBuildSkillFiles(confirmation, dependencies.skillRoot)
  const createSandbox = dependencies.createSandbox ?? createPlayableSandbox
  let sandbox: PlayableSandbox | undefined
  let operationError: unknown
  let stage: PlayableBuildExecutionStage = 'sandbox_create'

  try {
    sandbox = await createSandbox(input.taskId, dependencies.abortSignal)
    const sandboxRoot = sandbox.defaultWorkingDirectory
    const masterRoot = path.join(sandboxRoot, 'skill-master')
    const workspace = path.join(sandboxRoot, 'work')
    stage = 'workspace'
    if (serializedConfirmation.includes(input.apiKey)) {
      throw new Error('Confirmation contains a credential')
    }
    if (redactSecrets(serializedConfirmation) !== serializedConfirmation) {
      throw new Error('Confirmation contains a credential')
    }
    await dependencies.logger?.info('Preparing isolated playable workspace')
    for (const file of skillFiles) {
      await sandbox.writeBinaryFile({
        path: path.join(masterRoot, file.relativePath),
        content: file.content,
        abortSignal: dependencies.abortSignal,
      })
    }
    await requireSuccessfulCommand(
      sandbox,
      { command: 'cp -R skill-master work', workingDirectory: sandboxRoot, abortSignal: dependencies.abortSignal },
      'Failed to copy playable workspace',
    )
    await requireSuccessfulCommand(
      sandbox,
      {
        command: 'chmod -R a-w skill-master',
        workingDirectory: sandboxRoot,
        abortSignal: dependencies.abortSignal,
      },
      'Failed to protect Skill master',
    )
    await sandbox.writeTextFile({
      path: path.join(workspace, 'confirmed-config.json'),
      content: serializedConfirmation,
      abortSignal: dependencies.abortSignal,
    })
    if (input.revision) {
      await sandbox.writeTextFile({
        path: path.join(workspace, 'revision-plan.json'),
        content: JSON.stringify(input.revision, null, 2),
        abortSignal: dependencies.abortSignal,
      })
    }
    if (input.baseHtml) {
      await sandbox.writeTextFile({
        path: path.join(workspace, 'current-playable.html'),
        content: input.baseHtml,
        abortSignal: dependencies.abortSignal,
      })
    }
    if (input.gameplayBlueprint) {
      await sandbox.writeTextFile({
        path: path.join(workspace, 'gameplay-blueprint.json'),
        content: JSON.stringify(input.gameplayBlueprint, null, 2),
        abortSignal: dependencies.abortSignal,
      })
    }
    const assetManifest: PlayableAssetManifest = createAssetSourceManifest(confirmation, [])
    for (const asset of input.assets ?? []) {
      if (asset.bytes.byteLength !== asset.size) throw new Error('Uploaded asset size mismatch')
      const workspacePath = path.posix.join('user-assets', asset.slot, safeWorkspaceFilename(asset.id, asset.filename))
      await sandbox.writeBinaryFile({
        path: path.join(workspace, workspacePath),
        content: asset.bytes,
        abortSignal: dependencies.abortSignal,
      })
      const { bytes: _bytes, ...metadata } = asset
      void _bytes
      assetManifest.assets.push({ ...metadata, workspacePath })
      assetManifest.sources.find((source) => source.slot === asset.slot)?.files.push(asset.filename)
    }
    await sandbox.writeTextFile({
      path: path.join(workspace, 'asset-manifest.json'),
      content: JSON.stringify(assetManifest, null, 2),
      abortSignal: dependencies.abortSignal,
    })

    if (dependencies.preparedArtifact) {
      stage = 'artifact_build'
      await dependencies.logger?.info('Loading prepared playable artifact')
      await sandbox.writeBinaryFile({
        path: path.join(workspace, 'output.html'),
        content: dependencies.preparedArtifact,
        abortSignal: dependencies.abortSignal,
      })
    } else if (confirmation.sourceTemplateId || input.revision?.strategy === 'patch') {
      if (!input.baseHtml) throw new Error('Template source is missing')
      await sandbox.writeTextFile({
        path: path.join(workspace, 'output.html'),
        content: input.baseHtml,
        abortSignal: dependencies.abortSignal,
      })
    } else if (!freeform) {
      stage = 'artifact_build'
      await dependencies.logger?.info('Building playable baseline')
      await requireSuccessfulCommand(
        sandbox,
        {
          command: MAHJONG_PLAYABLE_PLUGIN.commands.build,
          workingDirectory: workspace,
          env: {
            PLAYABLE_MODE: confirmation.mode,
            PLAYABLE_STORE_URL: confirmation.storeUrl,
          },
          abortSignal: dependencies.abortSignal,
        },
        'Playable baseline build failed',
      )
    }

    await dependencies.logger?.info('Running playable agent')
    stage = 'agent'
    await dependencies.executeAgent({
      authEnvironment: {
        CODEX_API_KEY: input.apiKey,
        OPENAI_BASE_URL: OPENROUTER_BASE_URL,
      },
      sandbox,
      workspace,
      taskId: input.taskId,
      abortSignal: dependencies.abortSignal,
    })
    stage = 'integrity'
    await assertMasterUnchanged(sandbox, masterRoot, skillFiles, dependencies.abortSignal)

    stage = 'validation'
    input.onActivity?.('validating')
    await dependencies.logger?.info('Validating playable behavior')
    await requireSuccessfulCommand(
      sandbox,
      {
        command: buildValidationCommand(confirmation),
        workingDirectory: workspace,
        env: {
          PLAYABLE_MODE: confirmation.mode,
          PLAYABLE_PLUGIN_VERSION: MAHJONG_PLAYABLE_PLUGIN.version,
        },
        abortSignal: dependencies.abortSignal,
      },
      'Playable validation failed',
    )

    stage = 'artifact_check'
    const artifact = await sandbox.readBinaryFile({
      path: path.join(workspace, 'output.html'),
      abortSignal: dependencies.abortSignal,
    })
    if (artifact === null) throw new Error('Playable artifact is missing')

    const html = new TextDecoder().decode(artifact)
    assertRegisteredTemplateContract(confirmation, html)
    if (!html.includes('window.__PLAYABLE__')) throw new Error('Playable artifact contract is missing')
    if (html.includes(input.apiKey)) throw new Error('Playable artifact contains a credential')
    if (redactSecrets(html) !== html) throw new Error('Playable artifact contains a credential')
    if (hasExternalResourceReference(html)) throw new Error('Playable artifact contains an external resource')
    if (!hasResponsiveViewport(html)) throw new Error('Playable artifact is missing responsive viewport support')

    await assertMasterUnchanged(sandbox, masterRoot, skillFiles, dependencies.abortSignal)
    return {
      html,
      assetManifest,
      validation: createValidationReport({
        bytes: artifact.byteLength,
        offlineResources: true,
        responsiveViewport: true,
        delivery: input.confirmation.delivery,
      }),
    }
  } catch (error) {
    operationError = error
    throw error instanceof PlayableBuildExecutionError ? error : new PlayableBuildExecutionError(stage, error)
  } finally {
    if (sandbox) {
      try {
        await sandbox.destroy()
      } catch (destroyError) {
        if (operationError === undefined) throw new Error('Sandbox cleanup failed', { cause: destroyError })
      }
    }
  }
}
