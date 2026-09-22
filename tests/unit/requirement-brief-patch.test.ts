import { describe, expect, it } from 'vitest'
import { applyRequirementBriefPatch, type RequirementBriefPatch } from '@/lib/playable/requirement-brief-patch'
import {
  createRequirementBrief,
  executeRequirementToolPlan,
  requirementAgentStepOutputSchema,
} from '@/lib/playable/requirement-tools'

const emptyPatch: RequirementBriefPatch = {
  kind: 'patch',
  summary: null,
  gameplay: null,
  experience: null,
  assets: null,
  launch: null,
  constraints: null,
  openQuestions: null,
  routing: null,
}

describe('incremental Requirement Brief updates', () => {
  it('preserves previous constraints and host bindings across successive user changes', () => {
    const initial = {
      ...createRequirementBrief('保留胜利动画'),
      sourceHtmlAssetId: 'uploaded-html',
      importedAssetIds: ['asset-package'],
      constraints: ['保留胜利动画'],
      launch: { title: '原始标题', cta: '安装', locale: 'zh-CN', storeUrl: 'https://example.com/app' },
    }
    const first = applyRequirementBriefPatch(initial, {
      ...emptyPatch,
      constraints: { add: ['按钮改成红色'], remove: [] },
    })
    const second = applyRequirementBriefPatch(first, {
      ...emptyPatch,
      launch: { title: '新标题', cta: null, locale: null, storeUrl: null },
    })
    expect(second.constraints).toEqual(['保留胜利动画', '按钮改成红色'])
    expect(second.launch).toEqual({ ...initial.launch, title: '新标题' })
    expect(second.sourceHtmlAssetId).toBe('uploaded-html')
    expect(second.importedAssetIds).toEqual(['asset-package'])
    expect(initial.constraints).toEqual(['保留胜利动画'])
    expect(first.launch.title).toBe('原始标题')
  })

  it('removes only explicitly superseded entries and supports intentional text clearing', () => {
    const initial = {
      ...createRequirementBrief(),
      constraints: ['红色按钮', '保留动画'],
      openQuestions: ['什么颜色？'],
    }
    const next = applyRequirementBriefPatch(initial, {
      ...emptyPatch,
      constraints: { add: ['蓝色按钮', '蓝色按钮'], remove: ['红色按钮'] },
      openQuestions: { add: [], remove: ['什么颜色？'] },
      summary: '',
    })
    expect(next.constraints).toEqual(['保留动画', '蓝色按钮'])
    expect(next.openQuestions).toEqual([])
    expect(next.summary).toBe('')
  })

  it('rejects contradictory list edits and host-owned fields without mutating the brief', () => {
    const initial = { ...createRequirementBrief(), constraints: ['保留动画'] }
    expect(() =>
      applyRequirementBriefPatch(initial, {
        ...emptyPatch,
        constraints: { add: ['保留动画'], remove: ['保留动画'] },
      }),
    ).toThrow('Brief list update cannot add and remove the same entry')
    expect(() => applyRequirementBriefPatch(initial, { ...emptyPatch, sourceHtmlAssetId: 'other-html' })).toThrow()
    expect(initial.constraints).toEqual(['保留动画'])
  })

  it('executes a patch through the domain plan and permits an all-null clarification update', () => {
    const initial = { ...createRequirementBrief(), constraints: ['保留胜利动画'] }
    const result = executeRequirementToolPlan({
      currentBrief: initial,
      prompt: '还需要我提供什么？',
      plan: {
        message: '请说明核心玩法。',
        reasoning: '核心玩法尚未明确。',
        calls: [
          {
            name: 'update_requirement_brief',
            brief: emptyPatch,
            annotations: null,
            request: null,
            confirmation: null,
            revision: null,
          },
          {
            name: 'ask_user',
            brief: null,
            annotations: null,
            confirmation: null,
            revision: null,
            request: { type: 'text', question: '核心玩法是什么？', options: [], allowCustom: true },
          },
        ],
      },
    })
    expect(result.brief).toEqual(initial)
    expect(result.reply.kind).toBe('clarification')
    expect(
      requirementAgentStepOutputSchema.shape.plan.unwrap().shape.calls.element.shape.brief.safeParse(initial).success,
    ).toBe(false)
  })
})
