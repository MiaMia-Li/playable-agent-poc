import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import postgres from 'postgres'
import { get } from '@vercel/blob'

interface TaskBuildLookup {
  userId: string
  taskId: string
  failedBuildId: string | null
  latestBuildStatus: 'building' | 'failed' | 'succeeded' | null
}

export interface SandboxLogsDependencies {
  findTaskBuilds(taskId: string): Promise<TaskBuildLookup | undefined>
  download(key: string): Promise<string | undefined>
  save(taskId: string, text: string): Promise<void>
}

export class SandboxLogsError extends Error {}

export async function downloadTaskSandboxLogs(args: string[], dependencies: SandboxLogsDependencies): Promise<void> {
  const [taskId] = args
  if (args.length !== 1 || !taskId || !/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) {
    throw new SandboxLogsError('Usage: pnpm sandbox:logs <taskId>')
  }
  const task = await dependencies.findTaskBuilds(taskId)
  if (!task) {
    throw new SandboxLogsError(
      'Task not found in the configured database. Check the task ID and POSTGRES_URL environment.',
    )
  }
  if (!task.failedBuildId) {
    if (task.latestBuildStatus === 'succeeded') {
      throw new SandboxLogsError(
        'This task has no failed builds; its latest build succeeded. sandbox:logs only downloads failed-build diagnostics, not general Sandbox logs.',
      )
    }
    if (task.latestBuildStatus === 'building') {
      throw new SandboxLogsError(
        'This task has no failed builds; its latest build is still marked as building. sandbox:logs only downloads failed-build diagnostics, not live Sandbox logs.',
      )
    }
    throw new SandboxLogsError('This task has no builds yet. Sandbox diagnostics are only saved after a build fails.')
  }
  const key = `users/${task.userId}/tasks/${task.taskId}/${task.failedBuildId}/sandbox-diagnostics.json`
  const text = await dependencies.download(key)
  if (text === undefined) {
    throw new SandboxLogsError(
      'The latest failed build has no diagnostics. It may predate diagnostics support or have failed before saving them.',
    )
  }
  await dependencies.save(taskId, text)
}

async function main(): Promise<void> {
  config({ path: '.env.local', quiet: true })
  await downloadTaskSandboxLogs(process.argv.slice(2), {
    async findTaskBuilds(taskId) {
      if (!process.env.POSTGRES_URL || !process.env.BLOB_READ_WRITE_TOKEN) {
        throw new SandboxLogsError('Set POSTGRES_URL and BLOB_READ_WRITE_TOKEN in .env.local or the environment')
      }
      const sql = postgres(process.env.POSTGRES_URL, { max: 1, connect_timeout: 10 })
      try {
        const rows = await sql<TaskBuildLookup[]>`
          SELECT tasks.user_id AS "userId", tasks.id AS "taskId",
            (
              SELECT builds.id FROM playable_task_builds AS builds
              WHERE builds.task_id = tasks.id AND builds.status = 'failed'
              ORDER BY builds.created_at DESC, builds.id DESC
              LIMIT 1
            ) AS "failedBuildId",
            (
              SELECT builds.status FROM playable_task_builds AS builds
              WHERE builds.task_id = tasks.id
              ORDER BY builds.created_at DESC, builds.id DESC
              LIMIT 1
            ) AS "latestBuildStatus"
          FROM tasks
          WHERE tasks.id = ${taskId}
        `
        return rows[0]
      } finally {
        await sql.end({ timeout: 5 })
      }
    },
    async download(key) {
      const blob = await get(key, { access: 'private' })
      return blob?.stream ? await new Response(blob.stream).text() : undefined
    },
    async save(taskId, text) {
      const directory = resolve('.sandbox-logs')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = resolve(directory, `${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
        await rename(temporary, resolve(directory, `${taskId}.json`))
      } finally {
        await rm(temporary, { force: true })
      }
    },
  })
  console.log('Sandbox diagnostics saved to .sandbox-logs/<taskId>.json')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    if (error instanceof SandboxLogsError) console.error(error.message)
    else console.error('Unable to download Sandbox diagnostics; check database and Blob credentials and connectivity')
    process.exitCode = 1
  })
}
