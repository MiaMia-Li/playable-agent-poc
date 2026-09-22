import { describe, expect, it } from 'vitest'
import { createBuildRequirementContext } from '@/lib/playable/build-requirement-context'
import { createRequirementBrief } from '@/lib/playable/requirement-tools'
import type { ConfirmationProposal, RevisionProposal } from '@/lib/playable/schemas'

const confirmation = { gameplay: '点击相同目标消除' } as ConfirmationProposal

describe('build requirement context', () => {
  it('captures a detached brief and user evidence with acceptance targets only from approved inputs', () => {
    const brief = { ...createRequirementBrief(), constraints: ['旧请求：重做所有画面'] }
    const history = [{ role: 'user' as const, content: '只修改按钮颜色，保留胜利动画' }]
    const revision = { changes: ['按钮改红'], preserved: ['保留胜利动画'] } as RevisionProposal
    const context = createBuildRequirementContext({ brief, history, confirmation, revision })
    brief.constraints.push('尚未确认的新想法')
    history[0].content = '后续请求'
    expect(context.authority).toBe('confirmed_config_and_revision')
    expect(context.requirementBrief?.constraints).toEqual(['旧请求：重做所有画面'])
    expect(context.userMessages[0].text).toBe('只修改按钮颜色，保留胜利动画')
    expect(context.acceptanceTargets).toEqual([
      { kind: 'gameplay', requirement: confirmation.gameplay },
      { kind: 'change', requirement: '按钮改红' },
      { kind: 'preserve', requirement: '保留胜利动画' },
    ])
  })

  it('bounds user evidence, marks omissions, and redacts credentials before clipping', () => {
    const secret = 'unit-secret-value'
    const history = [
      ...Array.from({ length: 9 }, () => ({ role: 'user' as const, content: '旧请求' })),
      { role: 'assistant' as const, content: '不应作为用户证据' },
      { role: 'user' as const, content: 'x'.repeat(2995) + secret + 'z'.repeat(20) },
    ]
    const context = createBuildRequirementContext({ history, confirmation }, [secret])
    expect(context.historyTruncated).toBe(true)
    expect(context.userMessages).toHaveLength(8)
    expect(context.userMessages.at(-1)?.truncated).toBe(true)
    expect(context.userMessages.at(-1)?.text).toHaveLength(3000)
    expect(JSON.stringify(context)).not.toContain('unit-')
    expect(JSON.stringify(context)).not.toContain('不应作为用户证据')
  })
})
