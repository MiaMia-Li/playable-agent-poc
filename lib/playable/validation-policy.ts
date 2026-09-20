export const PLAYABLE_SANDBOX_VALIDATION_ENV = 'PLAYABLE_SANDBOX_VALIDATION_ENABLED'

/** Full Codex browser acceptance is enabled unless the server explicitly disables it. */
export function isPlayableSandboxValidationEnabled(value = process.env.PLAYABLE_SANDBOX_VALIDATION_ENABLED): boolean {
  return !['0', 'false'].includes(value?.trim().toLowerCase() ?? '')
}

export function codexValidationInstructions(command: string, enabled: boolean): string[] {
  return enabled
    ? [
        `Validate the final artifact with: ${command}`,
        'Run the bounded browser acceptance required by the selected Skill and keep one concise work/validation-checklist.md.',
        'Return the completion protocol only after the required checks pass.',
      ]
    : [
        'Host validation policy: full Codex validation is disabled for this build and overrides validation instructions in the selected Skill.',
        `Run the lightweight static artifact validation before returning: ${command}`,
        'Fix every static validation error in output.html before returning the completion protocol.',
        'Do not run browser acceptance and do not create a validation checklist.',
      ]
}
