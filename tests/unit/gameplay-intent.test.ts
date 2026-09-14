import { describe, expect, it } from 'vitest'
import { ATTACHMENT_ONLY_PROMPT, deriveGameplayIntent } from '@/lib/playable/gameplay-intent'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'

describe('gameplay intent', () => {
  it('reads intent from the brief rather than the opening prompt', () => {
    const brief = createRequirementBrief('做一个试玩')
    brief.gameplay.concept = '三消'
    brief.gameplay.controls = '滑动交换'

    expect(deriveGameplayIntent(brief, '做一个试玩')).toBe('概述：做一个试玩\n玩法概念：三消\n操作：滑动交换')
  })

  it('does not repeat a prompt the brief was seeded with', () => {
    expect(deriveGameplayIntent(createRequirementBrief('我想做三消'), '我想做三消')).toBe('概述：我想做三消')
  })

  // Otherwise every attachment-only task would be compared against "make a
  // playable from the references" and reported as diverging from it.
  it('treats the attachment-only placeholder as no intent at all', () => {
    expect(deriveGameplayIntent(null, ATTACHMENT_ONLY_PROMPT)).toBe('')
    expect(deriveGameplayIntent(createRequirementBrief(ATTACHMENT_ONLY_PROMPT), ATTACHMENT_ONLY_PROMPT)).toBe('')
  })
})
