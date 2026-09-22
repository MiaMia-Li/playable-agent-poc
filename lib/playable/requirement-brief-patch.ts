import { z } from 'zod'
import { requirementBriefSchema, type RequirementBrief } from './schemas'

const fields = requirementBriefSchema.shape
const listChange = z.strictObject({
  add: z.array(z.string().trim().min(1).max(300)).max(20),
  remove: z.array(z.string().trim().min(1).max(300)).max(20),
})

// Every property is required for structured output. Null means retain the
// current value; clearing a string or removing a list entry must be explicit.
export const requirementBriefPatchSchema = z.strictObject({
  kind: z.literal('patch'),
  summary: fields.summary.nullable(),
  gameplay: z
    .strictObject({
      concept: fields.gameplay.shape.concept.nullable(),
      coreLoop: fields.gameplay.shape.coreLoop.nullable(),
      controls: fields.gameplay.shape.controls.nullable(),
      objective: fields.gameplay.shape.objective.nullable(),
    })
    .nullable(),
  experience: z
    .strictObject({
      visualTheme: fields.experience.shape.visualTheme.nullable(),
      tone: fields.experience.shape.tone.nullable(),
      camera: fields.experience.shape.camera.nullable(),
    })
    .nullable(),
  assets: z
    .strictObject({
      images: fields.assets.shape.images.nullable(),
      models: fields.assets.shape.models.unwrap().nullable(),
      audio: fields.assets.shape.audio.nullable(),
    })
    .nullable(),
  launch: z
    .strictObject({
      title: fields.launch.shape.title.nullable(),
      cta: fields.launch.shape.cta.nullable(),
      locale: fields.launch.shape.locale.nullable(),
      storeUrl: fields.launch.shape.storeUrl.nullable(),
    })
    .nullable(),
  constraints: listChange.nullable(),
  openQuestions: listChange.nullable(),
  // Routing is one decision: replace it together, or retain it with null.
  routing: fields.routing.nullable(),
})

export type RequirementBriefPatch = z.infer<typeof requirementBriefPatchSchema>

function mergeFields<T extends Record<string, unknown>>(current: T, changes: Record<string, unknown> | null): T {
  return { ...current, ...Object.fromEntries(Object.entries(changes ?? {}).filter(([, value]) => value !== null)) }
}

function updateList(current: string[], changes: z.infer<typeof listChange> | null): string[] {
  if (!changes) return [...current]
  if (changes.add.some((value) => changes.remove.includes(value))) {
    throw new Error('Brief list update cannot add and remove the same entry')
  }
  return [...new Set([...current.filter((value) => !changes.remove.includes(value)), ...changes.add])]
}

export function applyRequirementBriefPatch(current: RequirementBrief, value: unknown): RequirementBrief {
  const patch = requirementBriefPatchSchema.parse(value)
  return requirementBriefSchema.parse({
    ...current,
    summary: patch.summary ?? current.summary,
    gameplay: mergeFields(current.gameplay, patch.gameplay),
    experience: mergeFields(current.experience, patch.experience),
    assets: mergeFields(current.assets, patch.assets),
    launch: mergeFields(current.launch, patch.launch),
    constraints: updateList(current.constraints, patch.constraints),
    openQuestions: updateList(current.openQuestions, patch.openQuestions),
    routing: patch.routing ?? current.routing,
  })
}

export const REQUIREMENT_BRIEF_PATCH_INSTRUCTIONS = [
  'For update_requirement_brief, put an incremental update in brief with kind patch. Never resend a full Requirement Brief.',
  'Set unchanged fields or whole unchanged sections to null; null preserves the current value. Use an empty string only to intentionally clear a text field. Preserve earlier user choices unless the user changes them.',
  'constraints and openQuestions use add/remove arrays. Add new entries without resending existing ones. Remove an entry only when the user retracts it, it is superseded by the current request, or an open question is resolved. Empty arrays change nothing.',
  'Set routing to null unless the implementation route changes or is first established; when it changes, supply the complete route decision.',
  'On a first turn, fill the fields needed for the requested gameplay and the selected terminal action. Defaults apply only to unspecified fields. A requirement turn with no new brief facts may use an all-null patch.',
  'Keep the complete Confirmation Proposal consistent with the merged Requirement Brief, including earlier constraints that were not changed this turn.',
].join('\n')
