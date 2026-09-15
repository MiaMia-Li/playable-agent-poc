import { z } from 'zod'
import { APPLOVIN_MAX_BYTES, DELIVERY_PROFILE_IDS, matchesDeliveryProfileSnapshot } from './delivery-standards'
import { marketResearchReportSchema } from './research/schemas'
import { playableModeIds, sourceTemplateIds } from './types'

export const videoAnalysisStatuses = ['pending', 'preprocessing', 'analyzing', 'succeeded', 'failed'] as const

export const videoAnalysisStatusSchema = z.enum(videoAnalysisStatuses)

const gameplayEvidenceSchema = z.strictObject({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  observation: z.string().trim().min(1).max(500),
})

// Exported because gameplay annotations reuse this shape. See spec section 7.2.
export const gameplayInferenceSchema = z.strictObject({
  value: z.string().trim().min(1).max(1000),
  confidence: z.number().min(0).max(1),
  evidence: z.array(gameplayEvidenceSchema).max(12),
})

export const MAX_TIMELINE_SEGMENTS = 40

/**
 * One stretch of the reference video. The timeline is the draft the user
 * reviews segment by segment (spec section 7.6), so every field is something a
 * person can check by jumping to `startSeconds` and watching.
 *
 * The length bounds are generous on purpose. They are stripped from the
 * response schema because the gateway rejects them, so the model never sees
 * them; the prompt asks for shorter text instead, and one long caption should
 * not throw away a billed run.
 */
export const gameplayTimelineSegmentSchema = z.strictObject({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  phase: z.enum(['intro', 'tutorial', 'gameplay', 'transition', 'result', 'end_card']),
  screen: z.string().trim().min(1).max(500),
  /** Verbatim, empty when there is none. Untrusted evidence, like narration (spec section 5.3). */
  onScreenText: z.string().trim().max(1000),
  /**
   * Null for automatic play and transitions. `seenVia` says how the model knows
   * about the input: a screen recording rarely shows the finger, and an input
   * read off the game's response is the kind the model was found to invent
   * (spec section 7.5.1), so the UI marks those as inferred.
   */
  playerInput: z
    .strictObject({
      action: z.enum(['tap', 'long_press', 'swipe', 'drag', 'unknown']),
      target: z.string().trim().min(1).max(300),
      seenVia: z.enum(['touch_indicator', 'guide_hand', 'ui_response']),
    })
    .nullable(),
  response: z.string().trim().max(500),
  audioCue: z.string().trim().max(300),
  confidence: z.number().min(0).max(1),
})

/**
 * Every visual list item names what it describes and cites when it is seen, so
 * the build agent can line it up with a Reference Keyframe. No `confidence`:
 * appearance is seen directly, and doubt belongs in `uncertainties`.
 */
const visualItemShape = {
  name: z.string().trim().min(1).max(120),
  evidence: z.array(gameplayEvidenceSchema).min(1).max(6),
}

/**
 * What the Reference Video looks like (Visual Spec in CONTEXT.md). Entity
 * appearance lives here, keyed by the name used in `entities`, which holds only
 * the entity's role in play.
 */
export const visualSpecSchema = z.strictObject({
  artStyle: z.string().trim().max(600),
  palette: z
    .array(
      z.strictObject({
        hex: z
          .string()
          .trim()
          .regex(/^#[0-9a-fA-F]{6}$/),
        usage: z.string().trim().max(120),
      }),
    )
    .max(10),
  background: z.string().trim().max(600),
  layout: z
    .array(
      z.strictObject({
        ...visualItemShape,
        region: z.string().trim().max(120),
        contents: z.string().trim().max(400),
      }),
    )
    .max(8),
  uiComponents: z
    .array(
      z.strictObject({
        ...visualItemShape,
        position: z.string().trim().max(160),
        shape: z.string().trim().max(300),
        colors: z.string().trim().max(200),
        textStyle: z.string().trim().max(200),
      }),
    )
    .max(16),
  entityLooks: z.array(z.strictObject({ ...visualItemShape, look: z.string().trim().max(500) })).max(20),
  effects: z
    .array(
      z.strictObject({
        ...visualItemShape,
        trigger: z.string().trim().max(200),
        motion: z.string().trim().max(400),
      }),
    )
    .max(12),
})

export const MAX_REFERENCE_KEYFRAMES = 12

/** A moment the model picked to be cut out as a Reference Keyframe. */
export const referenceKeyframeSchema = z.strictObject({
  seconds: z.number().min(0),
  focus: z.string().trim().min(1).max(200),
})

/**
 * One constant for the schema literal and the prompt that names it. When the
 * schema moved to 3 and the prompt still asked for "v2", a model that ignored
 * the schema's `const` wrote 2 and every attempt was rejected.
 */
export const GAMEPLAY_BLUEPRINT_VERSION = 4

/**
 * What the model produces and what gets stored. It deliberately has no
 * `annotations` field: this schema is also the source of the response schema
 * sent to the model, so a field here is a field the model would invent content
 * for, collapsing the separation between observation and user statement.
 * Annotations are attached on the way out, by `toGameplayBlueprintDocument`.
 */
export const gameplayBlueprintSchema = z.strictObject({
  version: z.literal(GAMEPLAY_BLUEPRINT_VERSION),
  summary: z.string().trim().min(1).max(1000),
  orientation: z.enum(['portrait', 'landscape', 'square', 'unknown']),
  // Early in the schema because the response schema's property order is the
  // order the model writes in, and the thematic fields below should be drawn
  // from a timeline that already exists.
  timeline: z.array(gameplayTimelineSegmentSchema).max(MAX_TIMELINE_SEGMENTS),
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
  visualSpec: visualSpecSchema,
  keyframes: z.array(referenceKeyframeSchema).max(MAX_REFERENCE_KEYFRAMES),
  audio: z.array(gameplayInferenceSchema).max(12),
  intentDivergence: z.array(gameplayInferenceSchema).max(8),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(12),
  overallConfidence: z.number().min(0).max(1),
})

/**
 * What the requirement agent emits. It supplies only the statement and the
 * timestamps it refers to; confidence, source and asset binding are all
 * definitional and are filled in server side, so the agent cannot hedge on a
 * user's own words or guess at an asset id.
 */
export const gameplayAnnotationDraftSchema = z.strictObject({
  value: z.string().trim().min(1).max(1000),
  evidence: z.array(gameplayEvidenceSchema).min(1).max(12),
})

/**
 * Where the user made the statement. The requirement agent rewrites its whole
 * list every turn, so it may only replace the ones made in chat: a correction
 * typed into the timeline while a turn is running would otherwise vanish when
 * that turn writes its list back (spec section 7.6.5). Rows from before the
 * timeline were all made in chat, hence the default.
 */
export const gameplayAnnotationOrigins = ['chat', 'timeline'] as const

export const gameplayAnnotationSchema = z.strictObject({
  id: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  source: z.literal('user'),
  ...gameplayAnnotationDraftSchema.shape,
  confidence: z.literal(1),
  origin: z.enum(gameplayAnnotationOrigins).default('chat'),
})

export const MAX_GAMEPLAY_ANNOTATIONS = 40

export const gameplayAnnotationsSchema = z.array(gameplayAnnotationSchema).max(MAX_GAMEPLAY_ANNOTATIONS)

/**
 * A correction typed into the timeline. The form asks what actually happens in
 * the video, so it skips the agent's observation-versus-intent split; spec
 * section 11 accepts that a user may still type a requirement into it.
 */
export const timelineCorrectionSchema = z
  .strictObject({
    value: gameplayAnnotationDraftSchema.shape.value,
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
  })
  .refine((correction) => correction.endSeconds >= correction.startSeconds)

/**
 * The reply carries drafts rather than stored annotations because it is
 * produced before anything is persisted; ids and asset binding do not exist
 * yet. It is a mirror for the current turn only — the durable list the user
 * sees and deletes from is read from `tasks.gameplay_annotations`.
 */
export const gameplayAnnotationDraftsSchema = z.array(gameplayAnnotationDraftSchema).max(MAX_GAMEPLAY_ANNOTATIONS)

/**
 * Carried as a field rather than an instruction because the build sandbox agent
 * only ever sees `gameplay-blueprint.json`; there is no instruction string on
 * that path. As a literal it travels with the JSON by construction, and
 * dropping it fails type-check rather than silently weakening the document.
 */
export const ANNOTATIONS_POLICY = '用户标注为权威陈述，与模型推论冲突时以标注为准' as const

export const gameplayBlueprintDocumentSchema = gameplayBlueprintSchema.extend({
  annotationsPolicy: z.literal(ANNOTATIONS_POLICY),
  annotations: gameplayAnnotationsSchema,
})

/**
 * The only place storage-shaped blueprints become document-shaped ones.
 * Callers must pass annotations already filtered to the analysed asset —
 * the Active Reference Video can change, and annotations outlive that change.
 */
export function toGameplayBlueprintDocument(
  blueprint: GameplayBlueprint,
  annotations: GameplayAnnotation[],
): GameplayBlueprintDocument {
  return gameplayBlueprintDocumentSchema.parse({
    ...gameplayBlueprintSchema.parse(blueprint),
    annotationsPolicy: ANNOTATIONS_POLICY,
    annotations,
  })
}

export type GameplayInference = z.infer<typeof gameplayInferenceSchema>
export type VisualSpec = z.infer<typeof visualSpecSchema>
export type ReferenceKeyframe = z.infer<typeof referenceKeyframeSchema>
export type GameplayBlueprint = z.infer<typeof gameplayBlueprintSchema>
export type GameplayBlueprintDocument = z.infer<typeof gameplayBlueprintDocumentSchema>
export type GameplayAnnotation = z.infer<typeof gameplayAnnotationSchema>
export type GameplayAnnotationDraft = z.infer<typeof gameplayAnnotationDraftSchema>
export type GameplayAnnotationOrigin = (typeof gameplayAnnotationOrigins)[number]
export type GameplayTimelineSegment = z.infer<typeof gameplayTimelineSegmentSchema>
export type TimelineCorrection = z.infer<typeof timelineCorrectionSchema>
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

const deliverySnapshotShape = {
  network: z.enum(['applovin', 'generic']),
  logicalWidth: z.literal(360),
  logicalHeight: z.literal(640),
  output: z.literal('single-html'),
  maxBytes: z.union([z.literal(APPLOVIN_MAX_BYTES), z.null()]),
}

function validateDeliveryProfileSnapshot(
  delivery: Parameters<typeof matchesDeliveryProfileSnapshot>[0],
  context: z.RefinementCtx,
) {
  if (!matchesDeliveryProfileSnapshot(delivery)) {
    context.addIssue({ code: 'custom', message: 'Delivery fields must match the selected profile' })
  }
}

const persistedDeliverySchema = z
  .strictObject({
    profileId: z.enum(DELIVERY_PROFILE_IDS).optional(),
    ...deliverySnapshotShape,
  })
  .superRefine(validateDeliveryProfileSnapshot)

const generatedDeliverySchema = z
  .strictObject({
    profileId: z.enum(DELIVERY_PROFILE_IDS),
    ...deliverySnapshotShape,
  })
  .superRefine(validateDeliveryProfileSnapshot)

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
  delivery: persistedDeliverySchema,
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

// 截图来源与修改基线独立：跨版本图片可作对照，但不能自动成为构建起点。
export const referenceImageEvidenceSchema = z.strictObject({
  assetId: z.string().min(1),
  filename: z.string(),
  sourceBuildId: z.string().nullable(),
  sourceVersion: z.number().int().positive().nullable(),
  purpose: z.enum(['problem', 'target']),
  description: z.string().max(4000),
})
export type ReferenceImageEvidence = z.infer<typeof referenceImageEvidenceSchema>

export const confirmationProposalSchema = z
  .strictObject({
    referenceImages: z.array(referenceImageEvidenceSchema).max(10).optional(),
    sourceTemplateId: z.enum(sourceTemplateIds).nullable().optional(),
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
    delivery: generatedDeliverySchema,
  })
  .superRefine(validateConfirmationPresentation)

export const revisionStrategies = ['patch', 'regenerate'] as const

export const revisionPlanSchema = z.strictObject({
  // 兼容旧记录缺省；非空时必须解析到真实的历史产物，不能退回最新版本。
  requestedBaseVersion: z.number().int().positive().nullable().optional(),
  parameterOnly: z.boolean().optional(),
  strategy: z.enum(revisionStrategies),
  summary: z.string().trim().min(1).max(600),
  changes: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
  preserved: z.array(z.string().trim().min(1).max(300)).max(12),
})

export const revisionProposalSchema = z.strictObject({
  // 持久化手动锁定标记，使后续确认请求也保留用户选择的基线。
  baseSelection: z.literal('manual').optional(),
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
  sourceTemplateId: z.enum(sourceTemplateIds).nullable().optional(),
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
    annotations: gameplayAnnotationDraftsSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('clarification'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    options: z.array(clarificationOptionSchema).max(8),
    request: requirementInputRequestSchema.optional(),
    brief: requirementBriefSchema.optional(),
    annotations: gameplayAnnotationDraftsSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('confirmation'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    confirmation: confirmationProposalSchema,
    brief: requirementBriefSchema.optional(),
    annotations: gameplayAnnotationDraftsSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('revision'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    revision: revisionPlanSchema,
    confirmation: confirmationProposalSchema,
    brief: requirementBriefSchema.optional(),
    annotations: gameplayAnnotationDraftsSchema.optional(),
    tools: z.array(z.string().trim().min(1)).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal('research'),
    message: z.string().trim().min(1),
    reasoning: z.string().trim().min(1),
    research: marketResearchReportSchema,
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
