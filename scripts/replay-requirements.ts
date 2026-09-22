import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import postgres from 'postgres'
import { CodexPlayableAgent } from '../lib/playable/codex-playable-agent'
import {
  exportRequirementReplay,
  replayRequirementCase,
  requirementReplaySuiteSchema,
} from '../lib/playable/requirement-replay'
import { readOpenRouterApiKey, readPlayableAgentModel } from '../lib/playable/shared-ai-key'
import { readRequirementAgentConfig } from '../lib/playable/requirement-agent-config'
import { redactSecrets } from '../lib/playable/redact'

async function main() {
  config({ path: '.env.local', quiet: true })
  const [command, value, ...rest] = process.argv.slice(2)
  if (!value || rest.length || !['export', 'run'].includes(command)) {
    throw new Error('Invalid replay command')
  }
  await mkdir('.requirement-replays', { recursive: true, mode: 0o700 })
  const secrets = Object.entries(process.env)
    .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|POSTGRES_URL|TEAM_ID|PROJECT_ID/.test(key))
    .map(([, secret]) => secret ?? '')
    .filter(Boolean)
  if (command === 'export') {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(value) || !process.env.POSTGRES_URL)
      throw new Error('Invalid export configuration')
    const sql = postgres(process.env.POSTGRES_URL, { max: 1, connect_timeout: 10 })
    try {
      const messages = await sql<Array<{ role: 'user' | 'agent'; content: string }>>`
        SELECT role, content FROM task_messages WHERE task_id = ${value} ORDER BY created_at, id
      `
      const suite = exportRequirementReplay(messages, secrets)
      await writeFile(resolve('.requirement-replays', `${value}.json`), JSON.stringify(suite, null, 2), {
        mode: 0o600,
        flag: 'wx',
      })
      console.log('Conversation exported. Review the historical context and add assertions before running a replay.')
    } finally {
      await sql.end({ timeout: 5 })
    }
    return
  }
  const suite = requirementReplaySuiteSchema.parse(JSON.parse(await readFile(value, 'utf8')))
  const apiKey = readOpenRouterApiKey()
  if (!apiKey) throw new Error('Shared model key is unavailable')
  const agent = new CodexPlayableAgent()
  const results: Array<Awaited<ReturnType<typeof replayRequirementCase>>> = []
  for (const sample of suite.cases) {
    results.push(await replayRequirementCase(sample, agent, apiKey, AbortSignal.timeout(180_000)))
  }
  const report = {
    version: 1,
    model: readPlayableAgentModel(),
    config: readRequirementAgentConfig(),
    results,
    summary: Object.fromEntries(
      ['passed', 'failed', 'incomplete', 'unscored', 'error'].map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
  }
  await writeFile(
    resolve('.requirement-replays', 'report.json'),
    redactSecrets(JSON.stringify(report, null, 2), secrets),
    { mode: 0o600 },
  )
  console.log('Requirement replay report saved to .requirement-replays/report.json.')
  if (results.some((result) => result.status !== 'passed')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => {
    console.error(
      'Requirement replay failed. Check the command, input file, database connection and shared model configuration.',
    )
    process.exitCode = 1
  })
}
