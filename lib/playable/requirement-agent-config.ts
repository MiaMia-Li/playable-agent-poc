export type RequirementReasoningEffort = 'low' | 'medium' | 'high'

export function readRequirementAgentConfig(environment: Record<string, string | undefined> = process.env): {
  maxSteps: number
  reasoningEffort: RequirementReasoningEffort
} {
  const maxSteps = Number(environment.PLAYABLE_REQUIREMENT_MAX_STEPS?.trim())
  const reasoningEffort = environment.PLAYABLE_REQUIREMENT_REASONING_EFFORT?.trim().toLowerCase()

  return {
    maxSteps: Number.isSafeInteger(maxSteps) && maxSteps > 0 ? maxSteps : 20,
    reasoningEffort: reasoningEffort === 'low' || reasoningEffort === 'medium' ? reasoningEffort : 'high',
  }
}
