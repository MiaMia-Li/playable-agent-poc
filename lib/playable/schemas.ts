import { z } from 'zod'
import { playableModeIds } from './types'

export const playableTaskPhases = [
  'draft',
  'awaiting_confirmation',
  'building',
  'validating',
  'ready',
  'failed',
  'cancelled',
] as const

export const playableTaskPhaseSchema = z.enum(playableTaskPhases)

export const resourceStatuses = ['用户上传', '内置默认', '待上传', '待生成'] as const

const resourceSchema = z.strictObject({
  status: z.enum(resourceStatuses),
  treatment: z.string().trim().min(1),
})

export const confirmationProposalSchema = z.strictObject({
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
  storeUrl: z
    .string()
    .url()
    .refine((value) => /^https:\/\//i.test(value), 'Store URL must use HTTPS'),
  delivery: z.strictObject({
    network: z.literal('applovin'),
    logicalWidth: z.literal(360),
    logicalHeight: z.literal(640),
    output: z.literal('single-html'),
    maxBytes: z.literal(5242880),
  }),
})

export type PlayableTaskPhase = z.infer<typeof playableTaskPhaseSchema>
export type ConfirmationProposal = z.infer<typeof confirmationProposalSchema>
