import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import type { BuildResult, ConfirmedBuildInput, PlayableAssetManifest } from './playable-agent-adapter'
import { createAssetSourceManifest, createValidationReport } from './production-contract'
import { redactSecrets } from './redact'
import { confirmationProposalSchema } from './schemas'
import { MAHJONG_PLAYABLE_PLUGIN } from './template-registry'

const DEFAULT_SKILL_ROOT = path.join(process.cwd(), 'skills/mahjong-pair-match-playable')

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
  authEnvironment: Readonly<Record<'CODEX_API_KEY', string>>
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

interface SkillFile {
  relativePath: string
  content: Uint8Array
}

async function readSkillFiles(root: string, directory = root): Promise<SkillFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry): Promise<SkillFile[]> => {
      if (isFilesystemMetadata(entry.name, entry.isDirectory())) return []
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) return readSkillFiles(root, absolutePath)
      if (!entry.isFile()) return []
      return [
        { relativePath: path.relative(root, absolutePath), content: new Uint8Array(await readFile(absolutePath)) },
      ]
    }),
  )
  return files.flat().sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function isFilesystemMetadata(name: string, directory: boolean): boolean {
  if (directory && ['.git', '.svn', '__MACOSX'].includes(name)) return true
  return name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name.startsWith('._')
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

  const cssResources = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
  for (const match of html.matchAll(cssResources)) {
    if (!isEmbeddedReference(match[1])) return true
  }
  return false
}

function hasResponsiveViewport(html: string): boolean {
  return /<meta\s+name=["']viewport["'][^>]*width=device-width/i.test(html) && /<canvas\b/i.test(html)
}

async function defaultCreateSandbox(taskId: string, abortSignal?: AbortSignal): Promise<PlayableSandbox> {
  const explicitCredentials =
    process.env.SANDBOX_VERCEL_TOKEN && process.env.SANDBOX_VERCEL_TEAM_ID && process.env.SANDBOX_VERCEL_PROJECT_ID
      ? {
          token: process.env.SANDBOX_VERCEL_TOKEN,
          teamId: process.env.SANDBOX_VERCEL_TEAM_ID,
          projectId: process.env.SANDBOX_VERCEL_PROJECT_ID,
        }
      : {}
  const provider = createVercelSandbox({
    runtime: 'node24',
    ports: [4000],
    ...explicitCredentials,
  })
  return provider.createSession({ sessionId: taskId, abortSignal })
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
  const confirmation = confirmationProposalSchema.parse(input.confirmation)
  const freeform = confirmation.routing.match === 'freeform'
  const serializedConfirmation = JSON.stringify(confirmation, null, 2)

  dependencies.abortSignal?.throwIfAborted()
  const skillFiles = await readSkillFiles(dependencies.skillRoot ?? DEFAULT_SKILL_ROOT)
  const createSandbox = dependencies.createSandbox ?? defaultCreateSandbox
  const sandbox = await createSandbox(input.taskId, dependencies.abortSignal)
  const sandboxRoot = sandbox.defaultWorkingDirectory
  const masterRoot = path.join(sandboxRoot, 'skill-master')
  const workspace = path.join(sandboxRoot, 'work')
  let operationError: unknown

  try {
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

    await dependencies.logger?.info('Running playable agent')
    await dependencies.executeAgent({
      authEnvironment: { CODEX_API_KEY: input.apiKey },
      sandbox,
      workspace,
      taskId: input.taskId,
      abortSignal: dependencies.abortSignal,
    })
    await assertMasterUnchanged(sandbox, masterRoot, skillFiles, dependencies.abortSignal)

    if (dependencies.preparedArtifact) {
      await dependencies.logger?.info('Loading prepared playable artifact')
      await sandbox.writeBinaryFile({
        path: path.join(workspace, 'output.html'),
        content: dependencies.preparedArtifact,
        abortSignal: dependencies.abortSignal,
      })
    } else if (!freeform) {
      await dependencies.logger?.info('Building playable artifact')
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
        'Playable build failed',
      )
    }

    await dependencies.logger?.info('Validating playable behavior')
    await requireSuccessfulCommand(
      sandbox,
      {
        command: freeform
          ? MAHJONG_PLAYABLE_PLUGIN.commands.validateFreeform
          : MAHJONG_PLAYABLE_PLUGIN.commands.validate,
        workingDirectory: workspace,
        abortSignal: dependencies.abortSignal,
      },
      'Playable validation failed',
    )

    const artifact = await sandbox.readBinaryFile({
      path: path.join(workspace, 'output.html'),
      abortSignal: dependencies.abortSignal,
    })
    if (artifact === null) throw new Error('Playable artifact is missing')
    if (artifact.byteLength >= MAHJONG_PLAYABLE_PLUGIN.delivery.maxBytes) {
      throw new Error('Playable artifact exceeds size limit')
    }

    const html = new TextDecoder().decode(artifact)
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
      }),
    }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      await sandbox.destroy()
    } catch (destroyError) {
      if (operationError === undefined) throw new Error('Sandbox cleanup failed', { cause: destroyError })
    }
  }
}
