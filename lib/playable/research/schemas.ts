import { z } from 'zod'

const boundedText = (max: number) => z.string().trim().min(1).max(max)
const boundedTextList = (maxItems: number, maxLength: number) => z.array(boundedText(maxLength)).max(maxItems)
const httpsUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Research sources must use valid HTTPS URLs')
  .describe('Absolute HTTPS source URL')

export const researchRunStatuses = [
  'suggested',
  'confirmed',
  'searching',
  'analyzing',
  'completed',
  'failed',
  'cancelled',
] as const

export const researchRunStatusSchema = z.enum(researchRunStatuses)

export const searchBriefSchema = z.strictObject({
  version: z.literal(1),
  trigger: z.enum(['explicit', 'suggested_confirmed']),
  category: boundedText(120),
  subcategory: z.string().trim().max(120),
  gameplayKeywords: boundedTextList(8, 80).min(1),
  market: boundedText(80),
  locale: boundedText(30),
  adNetwork: boundedText(80),
  timeRange: boundedText(80),
  focusAreas: boundedTextList(8, 120),
  requirementSummary: z.string().trim().max(600),
})

export const researchEvidenceSchema = z
  .strictObject({
    type: z.enum(['public_trend', 'internal_performance', 'third_party_estimate']),
    label: boundedText(120),
    value: z.string().trim().max(120).nullable(),
    sourceUrl: httpsUrlSchema,
    sourceTitle: boundedText(200),
    observedAt: z.string().datetime(),
    strength: z.enum(['weak', 'moderate', 'strong']),
  })
  .superRefine((evidence, context) => {
    if (
      evidence.type === 'public_trend' &&
      /\b(?:ctr|cvr|ipm|roas)\b|转化率|投资回报|付费表现/i.test(`${evidence.label} ${evidence.value ?? ''}`)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Public trends cannot claim conversion performance',
      })
    }
  })

export const marketResearchCandidateSchema = z.strictObject({
  id: boundedText(100),
  title: boundedText(200),
  sourceUrl: httpsUrlSchema,
  sourceTitle: boundedText(200),
  capturedAt: z.string().datetime(),
  categoryTags: boundedTextList(8, 80),
  markets: boundedTextList(8, 80),
  coreLoop: boundedText(800),
  controls: boundedText(300),
  openingHook: boundedText(500),
  stateChanges: boundedTextList(12, 300),
  feedback: boundedText(500),
  cta: boundedText(500),
  borrowableHighlights: boundedTextList(8, 300).min(1),
  excludedElements: boundedTextList(12, 300),
  evidence: z.array(researchEvidenceSchema).min(1).max(12),
  confidence: z.number().min(0).max(1),
  limitations: boundedTextList(12, 300),
})

export const marketResearchIndustrySummarySchema = z.strictObject({
  coreLoops: boundedTextList(8, 300),
  openingHooks: boundedTextList(8, 300),
  interactionPatterns: boundedTextList(8, 300),
  feedbackPatterns: boundedTextList(8, 300),
  ctaPatterns: boundedTextList(8, 300),
  trends: boundedTextList(8, 300),
  saturationRisks: boundedTextList(8, 300),
  opportunities: boundedTextList(8, 300),
})

export const marketResearchReportSchema = z
  .strictObject({
    version: z.literal(1),
    runId: boundedText(100),
    brief: searchBriefSchema,
    strategyVersion: boundedText(100),
    generatedAt: z.string().datetime(),
    industrySummary: marketResearchIndustrySummarySchema,
    candidates: z.array(marketResearchCandidateSchema).min(1).max(5),
    sourceCoverage: z.strictObject({
      sourceIds: boundedTextList(20, 100),
      failedSourceIds: boundedTextList(20, 100),
    }),
    warnings: boundedTextList(12, 300),
  })
  .superRefine((report, context) => {
    const candidateIds = report.candidates.map((candidate) => candidate.id)
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({ code: 'custom', path: ['candidates'], message: 'Candidate IDs must be unique' })
    }
  })

const selectedHighlightSchema = z.strictObject({
  candidateId: boundedText(100),
  value: boundedText(300),
})

export const referenceSelectionInputSchema = z
  .strictObject({
    runId: boundedText(100),
    primaryCandidateId: boundedText(100).nullable(),
    selectedHighlights: z.array(selectedHighlightSchema).max(12),
    customRequirements: z.string().trim().max(600),
    exclusions: boundedTextList(12, 300),
  })
  .superRefine((selection, context) => {
    const keys = selection.selectedHighlights.map((highlight) => `${highlight.candidateId}\0${highlight.value}`)
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: 'custom',
        path: ['selectedHighlights'],
        message: 'Selected highlights must be unique',
      })
    }
  })

export const resolvedReferenceSelectionSchema = z.strictObject({
  runId: boundedText(100),
  industrySummary: marketResearchIndustrySummarySchema,
  primaryCandidate: marketResearchCandidateSchema.nullable(),
  selectedHighlights: z
    .array(
      z.strictObject({
        candidate: marketResearchCandidateSchema,
        value: boundedText(300),
      }),
    )
    .max(12),
  customRequirements: z.string().trim().max(600),
  exclusions: boundedTextList(12, 300),
})

export type ResearchRunStatus = z.infer<typeof researchRunStatusSchema>
export type SearchBrief = z.infer<typeof searchBriefSchema>
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>
export type MarketResearchCandidate = z.infer<typeof marketResearchCandidateSchema>
export type MarketResearchIndustrySummary = z.infer<typeof marketResearchIndustrySummarySchema>
export type MarketResearchReport = z.infer<typeof marketResearchReportSchema>
export type ReferenceSelectionInput = z.infer<typeof referenceSelectionInputSchema>
export type ResolvedReferenceSelection = z.infer<typeof resolvedReferenceSelectionSchema>
