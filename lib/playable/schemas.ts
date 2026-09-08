import { z } from 'zod'
import { playableModeIds } from './types'

export const playableTaskPhases = [
  'draft',
  'awaiting_confirmation',
  'building',
  'validating',
  'reviewing',
  'ready',
  'needs_plugin',
  'failed',
  'cancelled',
] as const

export const playableTaskPhaseSchema = z.enum(playableTaskPhases)

export const resourceStatuses = ['用户上传', '内置默认', '待上传', '待生成'] as const

const resourceSchema = z.strictObject({
  status: z.enum(resourceStatuses),
  treatment: z.string().trim().min(1),
})

export function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

const routingDecisionSchema = z.strictObject({
  match: z.enum(['exact', 'approximate']),
  confidence: z.number().min(0).max(1),
  differences: z.array(z.string().trim().min(1)).max(12),
})

const confirmationProposalShape = {
  mode: z.enum(playableModeIds),
  gameplay: z.string().trim().min(1),
  resources: z.strictObject({
    tileFaces: resourceSchema,
    backgroundBoard: resourceSchema,
    animationEffects: resourceSchema,
    audio: resourceSchema,
    endCard: resourceSchema,
  }),
  copy: z.strictObject({
    title: z.string(),
    cta: z.string(),
    disclaimer: z.string(),
    locale: z.string(),
  }),
  storeUrl: z.string().url().refine(isAbsoluteHttpsUrl, 'Store URL must use HTTPS'),
  delivery: z.strictObject({
    network: z.literal('applovin'),
    logicalWidth: z.literal(360),
    logicalHeight: z.literal(640),
    output: z.literal('single-html'),
    maxBytes: z.literal(5242880),
  }),
}

export const confirmationProposalSchema = z.strictObject({
  routing: routingDecisionSchema.default({ match: 'exact', confidence: 1, differences: [] }),
  ...confirmationProposalShape,
})

const generatedConfirmationProposalSchema = z.strictObject({
  routing: routingDecisionSchema,
  ...confirmationProposalShape,
})

export const clarificationOptionSchema = z.strictObject({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  value: z.string().trim().min(1),
})

export const pluginRequestSchema = z.strictObject({
  summary: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  requiredStateMachine: z.array(z.string().trim().min(1)).min(1).max(12),
  source: z.enum(['text-description', 'reference-video']),
})

export const playableAgentReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('clarification'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    options: z.array(clarificationOptionSchema).min(1).max(6),
  }),
  z.strictObject({
    kind: z.literal('confirmation'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    confirmation: confirmationProposalSchema,
  }),
  z.strictObject({
    kind: z.literal('plugin_request'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    pluginRequest: pluginRequestSchema,
  }),
])

// The OpenAI structured-output subset does not permit `oneOf`. Keep a flat
// transport object, then restore the strict discriminated union at the boundary.
export const playableAgentOutputSchema = z.strictObject({
  kind: z.enum(['clarification', 'confirmation', 'plugin_request']),
  message: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
  options: z.array(clarificationOptionSchema).max(6),
  confirmation: generatedConfirmationProposalSchema.nullable(),
  pluginRequest: pluginRequestSchema.nullable(),
})

export function parsePlayableAgentOutput(value: unknown): PlayableAgentReply {
  const output = playableAgentOutputSchema.parse(value)
  if (output.kind === 'clarification') {
    if (output.confirmation !== null || output.pluginRequest !== null) {
      throw new Error('Clarification output contains another result')
    }
    return playableAgentReplySchema.parse({
      kind: output.kind,
      message: output.message,
      reasoning: output.reasoning,
      options: output.options,
    })
  }
  if (output.kind === 'plugin_request') {
    if (output.confirmation !== null || output.pluginRequest === null || output.options.length > 0) {
      throw new Error('Plugin request output is incomplete')
    }
    return playableAgentReplySchema.parse({
      kind: output.kind,
      message: output.message,
      reasoning: output.reasoning,
      pluginRequest: output.pluginRequest,
    })
  }
  if (output.confirmation === null || output.pluginRequest !== null || output.options.length > 0) {
    throw new Error('Confirmation output is incomplete')
  }
  return playableAgentReplySchema.parse({
    kind: output.kind,
    message: output.message,
    reasoning: output.reasoning,
    confirmation: output.confirmation,
  })
}

export type PlayableTaskPhase = z.infer<typeof playableTaskPhaseSchema>
export type ConfirmationProposal = z.infer<typeof confirmationProposalSchema>
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>
export type PluginRequest = z.infer<typeof pluginRequestSchema>
export type PlayableAgentReply = z.infer<typeof playableAgentReplySchema>
