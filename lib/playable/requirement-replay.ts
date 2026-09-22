import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { PlayableAgentError, type AgentInput, type PlayableAgentAdapter } from './playable-agent-adapter'
import {
  confirmationProposalSchema,
  playableAgentReplySchema,
  requirementBriefSchema,
  revisionProposalSchema,
} from './schemas'
import { requirementAnalysisToolCallSchema } from './requirement-tools'
import { readPlayableUserTurn } from './reference-images'
import { redactSecrets } from './redact'

const historySchema = z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string() }))
export const requirementReplayCaseSchema = z.strictObject({
  id: z.string().min(1),
  source: z.enum(['synthetic', 'recorded']),
  // A reviewer must check historical state, attachments and expected behavior.
  contextReviewed: z.boolean(),
  input: z.strictObject({
    prompt: z.string().min(1),
    history: historySchema,
    brief: requirementBriefSchema.nullable(),
    confirmation: confirmationProposalSchema.nullable(),
    hasArtifact: z.boolean(),
    pendingRevision: revisionProposalSchema.nullable(),
    sourceHtml: z
      .strictObject({ assetId: z.string(), filename: z.string(), html: z.string(), truncated: z.boolean() })
      .optional(),
    lockedRevisionBase: z
      .strictObject({
        buildId: z.string(),
        version: z.number().int().positive(),
        html: z.string(),
        truncated: z.boolean(),
      })
      .optional(),
    versions: z
      .array(
        z.strictObject({
          version: z.number().int().positive(),
          buildId: z.string(),
          isLatest: z.boolean(),
          acceptance: z.enum(['passed', 'pending', 'failed']).optional(),
        }),
      )
      .optional(),
  }),
  toolSnapshots: z.array(z.strictObject({ call: requirementAnalysisToolCallSchema, result: z.unknown() })),
  assertions: z.array(
    z.strictObject({
      path: z.array(z.string().min(1)).min(1),
      operator: z.enum(['equals', 'contains', 'not_contains']),
      value: z.unknown(),
    }),
  ),
})

export const requirementReplaySuiteSchema = z.strictObject({
  version: z.literal(1),
  cases: z.array(requirementReplayCaseSchema).min(1),
})
export type RequirementReplayCase = z.infer<typeof requirementReplayCaseSchema>
export type RequirementReplaySuite = z.infer<typeof requirementReplaySuiteSchema>

function atPath(value: unknown, parts: string[]): unknown {
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

export function checkReplayAssertions(reply: unknown, assertions: RequirementReplayCase['assertions']): boolean[] {
  return assertions.map((assertion) => {
    const actual = atPath(reply, assertion.path)
    if (assertion.operator === 'equals') return isDeepStrictEqual(actual, assertion.value)
    // A missing/wrongly typed field must not pass a negative assertion.
    if (!Array.isArray(actual) && typeof actual !== 'string') return false
    if (typeof actual === 'string' && typeof assertion.value !== 'string') return false
    const includes = Array.isArray(actual)
      ? actual.some((item) => isDeepStrictEqual(item, assertion.value))
      : typeof assertion.value === 'string' && actual.includes(assertion.value)
    return assertion.operator === 'contains' ? includes : !includes
  })
}

export async function replayRequirementCase(
  sample: RequirementReplayCase,
  agent: Pick<PlayableAgentAdapter, 'proposeConfirmation'>,
  apiKey: string,
  abortSignal?: AbortSignal,
) {
  let missingToolSnapshot = false
  try {
    const reply = await agent.proposeConfirmation(
      {
        ...sample.input,
        taskId: 'requirement-replay',
        apiKey,
      } satisfies AgentInput,
      {
        abortSignal,
        executeTool: async (call) => {
          // The transport uses nulls; executable calls omit unused fields.
          const normalise = (value: {
            name: string
            version?: number | null
            assetIds: string[]
            assetId: string | null
            searchBrief?: unknown
          }) => ({
            name: value.name,
            version: value.version ?? null,
            assetIds: [...new Set(value.assetIds)].sort(),
            assetId: value.assetId,
            searchBrief: value.searchBrief ?? null,
          })
          const snapshot = sample.toolSnapshots.find((entry) =>
            isDeepStrictEqual(normalise(entry.call), normalise(call)),
          )
          if (!snapshot) {
            missingToolSnapshot = true
            return { status: 'unavailable', reason: 'replay_tool_snapshot_missing' }
          }
          return structuredClone(snapshot.result)
        },
      },
    )
    const checks = checkReplayAssertions(reply, sample.assertions)
    const status =
      missingToolSnapshot || !sample.contextReviewed
        ? 'incomplete'
        : checks.length === 0
          ? 'unscored'
          : checks.every(Boolean)
            ? 'passed'
            : 'failed'
    return { id: sample.id, source: sample.source, status, checks, missingToolSnapshot, reply }
  } catch (error) {
    return {
      id: sample.id,
      source: sample.source,
      status: 'error',
      checks: [],
      missingToolSnapshot,
      ...(error instanceof PlayableAgentError ? { diagnostic: error.diagnostic } : {}),
    }
  }
}

// Export historical pre-turn state, never the task's latest brief (which would
// leak future user choices into earlier cases). Exports need human-labelled assertions.
export function exportRequirementReplay(
  messages: Array<{ role: 'user' | 'agent'; content: string }>,
  secrets: readonly string[] = [],
): RequirementReplaySuite {
  const cases: RequirementReplayCase[] = []
  const history: AgentInput['history'] = []
  let brief: AgentInput['brief'] = null
  let confirmation: AgentInput['confirmation'] = null
  for (const message of messages) {
    const content = redactSecrets(message.content, secrets)
    if (message.role === 'user') {
      const text = readPlayableUserTurn(content).text
      if (!text.trim()) continue
      cases.push({
        id: `turn-${cases.length + 1}`,
        source: 'recorded',
        contextReviewed: false,
        input: {
          prompt: text,
          history: structuredClone(history),
          brief: brief ?? null,
          confirmation: confirmation ?? null,
          // Messages contain an unresolved revision plan, not the host-bound
          // base version. Reviewers must restore that state for revision cases.
          pendingRevision: null,
          hasArtifact: false,
        },
        toolSnapshots: [],
        assertions: [],
      })
      history.push({ role: 'user', content: text })
    } else {
      let parsed: z.infer<typeof playableAgentReplySchema> | undefined
      try {
        parsed = playableAgentReplySchema.parse(JSON.parse(content))
      } catch {
        /* Historical plain text is valid context. */
      }
      if (parsed && 'brief' in parsed && parsed.brief) brief = parsed.brief
      if (parsed && 'confirmation' in parsed) confirmation = parsed.confirmation
      history.push({ role: 'assistant', content: parsed?.message ?? content })
    }
  }
  return requirementReplaySuiteSchema.parse({ version: 1, cases })
}
