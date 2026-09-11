import {
  confirmationProposalSchema,
  playableAgentReplySchema,
  requirementBriefSchema,
  type ConfirmationProposal,
  type PlayableAgentReply,
  type RequirementBrief,
} from './schemas'

function removeDeprecatedSourceTemplateId(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const { sourceTemplateId, ...currentValue } = value as Record<string, unknown>
  void sourceTemplateId
  return currentValue
}

export function parsePersistedRequirementBrief(value: unknown): RequirementBrief {
  return requirementBriefSchema.parse(removeDeprecatedSourceTemplateId(value))
}

export function parsePersistedConfirmation(value: unknown): ConfirmationProposal {
  return confirmationProposalSchema.parse(removeDeprecatedSourceTemplateId(value))
}

export function parsePersistedPlayableAgentReply(value: unknown): PlayableAgentReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return playableAgentReplySchema.parse(value)

  const reply = value as Record<string, unknown>
  return playableAgentReplySchema.parse({
    ...reply,
    ...(reply.brief === undefined ? {} : { brief: removeDeprecatedSourceTemplateId(reply.brief) }),
    ...(reply.confirmation === undefined
      ? {}
      : { confirmation: removeDeprecatedSourceTemplateId(reply.confirmation) }),
  })
}
