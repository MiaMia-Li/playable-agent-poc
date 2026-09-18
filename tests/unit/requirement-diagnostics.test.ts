import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { requirementDiagnostic } from '@/lib/playable/requirement-diagnostics'
import { requirementAgentStepOutputSchema } from '@/lib/playable/requirement-tools'

describe('requirement diagnostics', () => {
  it('finds nested SDK validation causes without storing values, messages or unknown keys', () => {
    // 把同一敏感串放进错误消息、字段值和动态键名，验证三条泄漏路径都被阻断。
    const secret = 'sk-private-secret-in-model-output'
    const parsed = z
      .object({
        plan: z.object({ calls: z.array(z.object({ mode: z.number() })) }),
        extra: z.record(z.string(), z.number()),
      })
      .safeParse({ plan: { calls: [{ mode: secret }] }, extra: { [secret]: secret } })
    if (parsed.success) throw new Error('Expected invalid fixture')
    const diagnostic = requirementDiagnostic(
      new Error(secret, { cause: parsed.error }),
      'structured_output',
      2,
      requirementAgentStepOutputSchema,
    )
    expect(diagnostic).toMatchObject({ stage: 'structured_output', step: 2, rule: 'schema_invalid' })
    expect(diagnostic.issues[0]).toEqual({ code: 'invalid_type', path: ['plan', 'calls', 0, 'mode'] })
    expect(JSON.stringify(diagnostic)).not.toContain(secret)
    expect(diagnostic.issues[1].path).toEqual(['[unknown]', '[unknown]'])
  })

  it('classifies known plan rules and drops arbitrary error details', () => {
    expect(
      requirementDiagnostic(
        new Error('Capabilities must be read before revision'),
        'plan_execution',
        1,
        requirementAgentStepOutputSchema,
      ).rule,
    ).toBe('revision_capabilities_missing')
    expect(
      requirementDiagnostic(
        new Error('secret arbitrary provider response'),
        'structured_output',
        1,
        requirementAgentStepOutputSchema,
      ),
    ).toEqual({ version: 1, stage: 'structured_output', step: 1, rule: 'unclassified', issues: [] })
  })

  it('names the rendering conflict using an application-owned rule instead of raw text', () => {
    const error = new z.ZodError([
      {
        code: 'custom',
        path: ['plan', 'calls', 2, 'confirmation', 'rendering'],
        message: 'Freeform builds must choose a concrete renderer',
      },
    ])
    expect(
      requirementDiagnostic(error, 'structured_output', 1, requirementAgentStepOutputSchema).issues[0],
    ).toMatchObject({ rule: 'freeform_template_renderer' })
  })

  it('bounds issue counts and handles circular error causes', () => {
    // 异常链可能自引用，模型也可能一次产生大量问题；诊断必须保持有界。
    const error = new Error('private')
    error.cause = error
    expect(requirementDiagnostic(error, 'structured_output', 1, requirementAgentStepOutputSchema).rule).toBe(
      'unclassified',
    )
    const parsed = z.array(z.number()).safeParse(Array(100).fill('private'))
    if (parsed.success) throw new Error('Expected invalid fixture')
    expect(
      requirementDiagnostic(parsed.error, 'step_validation', 1, requirementAgentStepOutputSchema).issues,
    ).toHaveLength(12)
  })
})
