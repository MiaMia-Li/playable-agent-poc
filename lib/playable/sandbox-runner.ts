import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import type { BuildResult, ConfirmedBuildInput } from './playable-agent-adapter'
import { redactSecrets } from './redact'
import { confirmationProposalSchema } from './schemas'

const MAX_PLAYABLE_BYTES = 5 * 1024 * 1024
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

async function defaultCreateSandbox(taskId: string, abortSignal?: AbortSignal): Promise<PlayableSandbox> {
  const provider = createVercelSandbox({
    runtime: 'node24',
    ports: [4000],
    ...(process.env.SANDBOX_VERCEL_TOKEN ? { token: process.env.SANDBOX_VERCEL_TOKEN } : {}),
    ...(process.env.SANDBOX_VERCEL_TEAM_ID ? { teamId: process.env.SANDBOX_VERCEL_TEAM_ID } : {}),
    ...(process.env.SANDBOX_VERCEL_PROJECT_ID ? { projectId: process.env.SANDBOX_VERCEL_PROJECT_ID } : {}),
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

    await dependencies.logger?.info('Running playable agent')
    await dependencies.executeAgent({
      authEnvironment: { CODEX_API_KEY: input.apiKey },
      sandbox,
      workspace,
      taskId: input.taskId,
      abortSignal: dependencies.abortSignal,
    })
    await assertMasterUnchanged(sandbox, masterRoot, skillFiles, dependencies.abortSignal)

    await dependencies.logger?.info('Building playable artifact')
    await requireSuccessfulCommand(
      sandbox,
      {
        command: 'node assets/starter/build-playable.mjs "$PLAYABLE_MODE" output.html "$PLAYABLE_STORE_URL"',
        workingDirectory: workspace,
        env: {
          PLAYABLE_MODE: confirmation.mode,
          PLAYABLE_STORE_URL: confirmation.storeUrl,
        },
        abortSignal: dependencies.abortSignal,
      },
      'Playable build failed',
    )

    await dependencies.logger?.info('Validating playable behavior')
    await requireSuccessfulCommand(
      sandbox,
      {
        command: 'node assets/starter/work/test-playable.mjs output.html',
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
    if (artifact.byteLength >= MAX_PLAYABLE_BYTES) throw new Error('Playable artifact exceeds size limit')

    const html = new TextDecoder().decode(artifact)
    if (!html.includes('window.__PLAYABLE__')) throw new Error('Playable artifact contract is missing')
    if (html.includes(input.apiKey)) throw new Error('Playable artifact contains a credential')
    if (redactSecrets(html) !== html) throw new Error('Playable artifact contains a credential')

    await assertMasterUnchanged(sandbox, masterRoot, skillFiles, dependencies.abortSignal)
    return {
      html,
      validation: {
        behavior: 'passed',
        bytes: artifact.byteLength,
      },
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
