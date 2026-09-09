import { z } from 'zod'
import { playableModeIds } from './types'

export const videoAnalysisStatuses = ['pending', 'preprocessing', 'analyzing', 'succeeded', 'failed'] as const

export const videoAnalysisStatusSchema = z.enum(videoAnalysisStatuses)

const gameplayEvidenceSchema = z.strictObject({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  observation: z.string().trim().min(1).max(500),
})

const gameplayInferenceSchema = z.strictObject({
  value: z.string().trim().min(1).max(1000),
  confidence: z.number().min(0).max(1),
  evidence: z.array(gameplayEvidenceSchema).max(12),
})

export const gameplayBlueprintSchema = z.strictObject({
  version: z.literal(1),
  summary: z.string().trim().min(1).max(1000),
  orientation: z.enum(['portrait', 'landscape', 'square', 'unknown']),
  controls: z.array(gameplayInferenceSchema).max(8),
  sceneStructure: gameplayInferenceSchema,
  entities: z.array(gameplayInferenceSchema).max(20),
  coreLoop: gameplayInferenceSchema,
  stateTransitions: z.array(gameplayInferenceSchema).max(20),
  objective: gameplayInferenceSchema,
  failureConditions: z.array(gameplayInferenceSchema).max(8),
  progression: z.array(gameplayInferenceSchema).max(12),
  tutorial: z.array(gameplayInferenceSchema).max(8),
  endCard: gameplayInferenceSchema.nullable(),
  visualStyle: z.string().trim().max(1000),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(12),
  overallConfidence: z.number().min(0).max(1),
})

export type GameplayBlueprint = z.infer<typeof gameplayBlueprintSchema>
export type VideoAnalysisStatus = z.infer<typeof videoAnalysisStatusSchema>

export const playableTaskPhases = [
  'draft',
  'awaiting_confirmation',
  'awaiting_revision_confirmation',
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

export const confirmationResourceSlots = [
  'tileFaces',
  'backgroundBoard',
  'animationEffects',
  'audio',
  'endCard',
] as const

export const confirmationCopyFields = ['title', 'cta', 'disclaimer', 'locale'] as const

const confirmationPresentationSchema = z.strictObject({
  assetFields: z
    .array(
      z.strictObject({
        slot: z.enum(confirmationResourceSlots),
        label: z.string().trim().min(1).max(40),
      }),
    )
    .max(confirmationResourceSlots.length),
  copyFields: z.array(z.enum(confirmationCopyFields)).max(confirmationCopyFields.length),
  showReferenceAssets: z.boolean(),
})

export const defaultConfirmationPresentation = {
  assetFields: [
    { slot: 'tileFaces' as const, label: '牌面素材' },
    { slot: 'backgroundBoard' as const, label: '背景与棋盘' },
    { slot: 'animationEffects' as const, label: '动画与特效' },
    { slot: 'audio' as const, label: '音频' },
    { slot: 'endCard' as const, label: '结束卡' },
  ],
  copyFields: [...confirmationCopyFields],
  showReferenceAssets: true,
}

export function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

export const routingDecisionSchema = z
  .strictObject({
    match: z.enum(['exact', 'approximate', 'freeform']),
    confidence: z.number().min(0).max(1),
    differences: z.array(z.string().trim().min(1)).max(12),
  })
  .superRefine((routing, context) => {
    if (routing.match === 'exact' && routing.differences.length > 0) {
      context.addIssue({ code: 'custom', path: ['differences'], message: 'Exact routes cannot contain differences' })
    }
    if (routing.match !== 'exact' && routing.differences.length === 0) {
      context.addIssue({ code: 'custom', path: ['differences'], message: 'Non-exact routes must list differences' })
    }
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
  // OpenAI Structured Outputs rejects JSON Schema's `format: "uri"`.
  // Keep URL validation at the Zod boundary without emitting that format.
  storeUrl: z.string().trim().max(2048).refine(isAbsoluteHttpsUrl, 'Store URL must use HTTPS'),
  delivery: z.strictObject({
    network: z.literal('applovin'),
    logicalWidth: z.literal(360),
    logicalHeight: z.literal(640),
    output: z.literal('single-html'),
    maxBytes: z.literal(5242880),
  }),
}

function validateConfirmationPresentation(
  proposal: {
    presentation: z.infer<typeof confirmationPresentationSchema>
    resources: Record<(typeof confirmationResourceSlots)[number], z.infer<typeof resourceSchema>>
  },
  context: z.RefinementCtx,
) {
  const slots = proposal.presentation.assetFields.map((field) => field.slot)
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: 'custom', path: ['presentation', 'assetFields'], message: 'Asset fields must be unique' })
  }
  const copyFields = proposal.presentation.copyFields
  if (new Set(copyFields).size !== copyFields.length) {
    context.addIssue({ code: 'custom', path: ['presentation', 'copyFields'], message: 'Copy fields must be unique' })
  }
  for (const slot of confirmationResourceSlots) {
    const hidden = !slots.includes(slot)
    const status = proposal.resources[slot].status
    if (hidden && (status === '待上传' || status === '待生成')) {
      context.addIssue({
        code: 'custom',
        path: ['resources', slot, 'status'],
        message: 'Pending resources must be visible in the confirmation table',
      })
    }
  }
}

export const confirmationProposalSchema = z
  .strictObject({
    routing: routingDecisionSchema.default({ match: 'exact', confidence: 1, differences: [] }),
    presentation: confirmationPresentationSchema.optional(),
    ...confirmationProposalShape,
  })
  .superRefine((proposal, context) => {
    if (proposal.presentation)
      validateConfirmationPresentation({ ...proposal, presentation: proposal.presentation }, context)
  })

export const generatedConfirmationProposalSchema = z
  .strictObject({
    routing: routingDecisionSchema,
    presentation: confirmationPresentationSchema,
    ...confirmationProposalShape,
  })
  .superRefine(validateConfirmationPresentation)

export const revisionStrategies = ['patch', 'regenerate'] as const

export const revisionPlanSchema = z.strictObject({
  strategy: z.enum(revisionStrategies),
  summary: z.string().trim().min(1).max(600),
  changes: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
  preserved: z.array(z.string().trim().min(1).max(300)).max(12),
})

export const revisionProposalSchema = z.strictObject({
  id: z.string().trim().min(1),
  baseBuildId: z.string().trim().min(1),
  baseVersion: z.number().int().positive(),
  targetVersion: z.number().int().positive(),
  ...revisionPlanSchema.shape,
})

export const clarificationOptionSchema = z.strictObject({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  value: z.string().trim().min(1),
})

export const requirementInputRequestSchema = z.strictObject({
  type: z.enum(['text', 'single_select', 'multi_select', 'url', 'approval']),
  question: z.string().trim().min(1),
  options: z.array(clarificationOptionSchema).max(8),
  allowCustom: z.boolean(),
})

export const requirementBriefSchema = z.strictObject({
  version: z.literal(1),
  summary: z.string().trim().max(600),
  gameplay: z.strictObject({
    concept: z.string().trim().max(500),
    coreLoop: z.string().trim().max(500),
    controls: z.string().trim().max(300),
    objective: z.string().trim().max(300),
  }),
  experience: z.strictObject({
    visualTheme: z.string().trim().max(300),
    tone: z.string().trim().max(200),
    camera: z.string().trim().max(200),
  }),
  assets: z.strictObject({
    images: z.enum(['unknown', 'bundled', 'upload']),
    audio: z.enum(['unknown', 'bundled', 'upload']),
  }),
  launch: z.strictObject({
    title: z.string().trim().max(120),
    cta: z.string().trim().max(80),
    locale: z.string().trim().max(30),
    storeUrl: z.string().trim().max(2048),
  }),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20),
  openQuestions: z.array(z.string().trim().min(1).max(300)).max(12),
  routing: z.strictObject({
    match: z.enum(['undecided', 'exact', 'approximate', 'freeform']),
    mode: z.enum(playableModeIds).nullable(),
    confidence: z.number().min(0).max(1),
    differences: z.array(z.string().trim().min(1).max(300)).max(12),
  }),
})

export const playableAgentReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('informational'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    brief: requirementBriefSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('clarification'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    options: z.array(clarificationOptionSchema).max(8),
    request: requirementInputRequestSchema.optional(),
    brief: requirementBriefSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('confirmation'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    confirmation: confirmationProposalSchema,
    brief: requirementBriefSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('revision'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    revision: revisionPlanSchema,
    confirmation: confirmationProposalSchema,
    brief: requirementBriefSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
])

// The OpenAI structured-output subset does not permit `oneOf`. Keep a flat
// transport object, then restore the strict discriminated union at the boundary.
export const playableAgentOutputSchema = z.strictObject({
  kind: z.enum(['clarification', 'confirmation']),
  message: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
  options: z.array(clarificationOptionSchema).max(6),
  confirmation: generatedConfirmationProposalSchema.nullable(),
})

export function parsePlayableAgentOutput(value: unknown): PlayableAgentReply {
  const output = playableAgentOutputSchema.parse(value)
  if (output.kind === 'clarification') {
    if (output.confirmation !== null) throw new Error('Clarification output contains another result')
    return playableAgentReplySchema.parse({
      kind: output.kind,
      message: output.message,
      reasoning: output.reasoning,
      options: output.options,
    })
  }
  if (output.confirmation === null || output.options.length > 0) {
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
export type RequirementInputRequest = z.infer<typeof requirementInputRequestSchema>
export type RequirementBrief = z.infer<typeof requirementBriefSchema>
export type RevisionPlan = z.infer<typeof revisionPlanSchema>
export type RevisionProposal = z.infer<typeof revisionProposalSchema>
export type PlayableAgentReply = z.infer<typeof playableAgentReplySchema>
