import { describe, expect, it } from 'vitest'
import { isPlayableSandboxValidationEnabled } from '@/lib/playable/validation-policy'

describe('playable Sandbox validation policy', () => {
  it('enables full validation by default', () => {
    expect(isPlayableSandboxValidationEnabled()).toBe(true)
    expect(isPlayableSandboxValidationEnabled('1')).toBe(true)
  })

  it('disables full validation for explicit false values', () => {
    expect(isPlayableSandboxValidationEnabled('0')).toBe(false)
    expect(isPlayableSandboxValidationEnabled('false')).toBe(false)
  })
})
