import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createRequirementBrief,
  executeRequirementToolPlan,
  playableCapabilitiesForAgent,
  requirementAgentPlanSchema,
} from '@/lib/playable/requirement-tools'
import {
  defaultConfirmationPresentation,
  type ConfirmationProposal,
  type RequirementBrief,
} from '@/lib/playable/schemas'

function routedBrief(match: 'exact' | 'approximate' | 'freeform'): RequirementBrief {
  return {
    ...createRequirementBrief('制作一个游戏'),
    gameplay: {
      concept: '麻将配对',
      coreLoop: match === 'freeform' ? '持续移动并躲避障碍' : '点击相同牌完成配对',
      controls: '点击或拖动',
      objective: '完成挑战',
    },
    experience: { visualTheme: '夏日清爽', tone: '轻松', camera: '竖屏' },
    assets: { images: 'bundled', audio: 'bundled' },
    launch: { title: '夏日挑战', cta: '立即试玩', locale: 'zh-CN', storeUrl: 'https://example.com/app' },
    openQuestions: [],
    routing: {
      match,
      mode: 'center_collision',
      confidence: match === 'exact' ? 1 : match === 'approximate' ? 0.7 : 0.1,
      differences: match === 'exact' ? [] : [match === 'freeform' ? '核心状态机不匹配' : '需要增加 Boss 表现'],
    },
  }
}

function confirmation(brief: RequirementBrief): ConfirmationProposal {
  return {
    routing: {
      match: brief.routing.match === 'undecided' ? 'freeform' : brief.routing.match,
      confidence: brief.routing.confidence,
      differences: brief.routing.differences,
    },
    presentation: defaultConfirmationPresentation,
    mode: brief.routing.mode ?? 'center_collision',
    gameplay: brief.gameplay.coreLoop,
    resources: {
      tileFaces: { status: '内置默认', treatment: '使用内置牌面' },
      backgroundBoard: { status: '内置默认', treatment: '使用内置背景' },
      animationEffects: { status: '内置默认', treatment: '使用内置特效' },
      audio: { status: '内置默认', treatment: '使用内置音频' },
      endCard: { status: '内置默认', treatment: '使用内置结束卡' },
    },
    copy: { title: '夏日挑战', cta: '立即试玩', disclaimer: '演示内容', locale: 'zh-CN' },
    storeUrl: 'https://example.com/app',
    delivery: {
      network: 'applovin',
      logicalWidth: 360,
      logicalHeight: 640,
      output: 'single-html',
      maxBytes: 5242880,
    },
  }
}

it('emits an OpenAI-compatible requirement schema without unsupported URI formats', () => {
  const jsonSchema = JSON.stringify(z.toJSONSchema(requirementAgentPlanSchema))

  expect(jsonSchema).not.toContain('"format":"uri"')
})

describe('requirement domain tools', () => {
  it('answers informational conversation without changing or routing the brief', () => {
    const currentBrief = createRequirementBrief()
    const result = executeRequirementToolPlan({
      prompt: '你是谁，能做什么？',
      currentBrief,
      plan: {
        message: '我是试玩创作助手，可以与你对话整理需求并构建试玩。',
        reasoning: '这是能力咨询，不是游戏需求。',
        calls: [{ name: 'respond_to_user', brief: null, request: null, confirmation: null }],
      },
    })

    expect(result.reply).toMatchObject({
      kind: 'informational',
      tools: ['respond_to_user'],
    })
    expect(result.brief).toEqual(currentBrief)
    expect(result.brief.routing.match).toBe('undecided')
  })

  it('rejects domain tool execution before an informational response', () => {
    expect(() =>
      executeRequirementToolPlan({
        prompt: '你能做什么？',
        plan: {
          message: '我可以帮你创作试玩。',
          reasoning: '这是能力咨询。',
          calls: [
            { name: 'list_playable_capabilities', brief: null, request: null, confirmation: null },
            { name: 'respond_to_user', brief: null, request: null, confirmation: null },
          ],
        },
      }),
    ).toThrow('Informational response cannot run domain tools')
  })

  it('executes a dynamic multi-select request and returns the updated brief', () => {
    const brief = { ...createRequirementBrief('消消乐'), openQuestions: ['选择体验重点'] }
    const result = executeRequirementToolPlan({
      prompt: '消消乐',
      plan: {
        message: '请选择最重要的体验方向。',
        reasoning: '体验优先级会影响实现。',
        calls: [
          { name: 'update_requirement_brief', brief, request: null, confirmation: null },
          {
            name: 'ask_user',
            brief: null,
            confirmation: null,
            request: {
              type: 'multi_select',
              question: '哪些体验最重要？',
              allowCustom: true,
              options: [
                { id: 'pace', label: '节奏', description: '更快的反馈', value: '重视节奏' },
                { id: 'visual', label: '画面', description: '更丰富的表现', value: '重视画面' },
              ],
            },
          },
        ],
      },
    })

    expect(result.reply).toMatchObject({
      kind: 'clarification',
      request: { type: 'multi_select' },
      tools: ['update_requirement_brief', 'ask_user'],
    })
    expect(result.brief.openQuestions).toEqual(['选择体验重点'])
  })

  it.each(['exact', 'approximate', 'freeform'] as const)('submits a validated %s implementation route', (match) => {
    const brief = routedBrief(match)
    const result = executeRequirementToolPlan({
      prompt: '制作游戏',
      plan: {
        message: '方案可以开始构建。',
        reasoning: '已完成能力匹配和交付检查。',
        calls: [
          { name: 'update_requirement_brief', brief, request: null, confirmation: null },
          { name: 'list_playable_capabilities', brief: null, request: null, confirmation: null },
          { name: 'validate_implementation_route', brief: null, request: null, confirmation: null },
          { name: 'submit_confirmation', brief: null, request: null, confirmation: confirmation(brief) },
        ],
      },
    })

    expect(result.reply.kind).toBe('confirmation')
    if (result.reply.kind === 'confirmation') expect(result.reply.confirmation.routing.match).toBe(match)
  })

  it('rejects confirmation before route validation', () => {
    const brief = routedBrief('exact')
    expect(() =>
      executeRequirementToolPlan({
        prompt: '制作游戏',
        plan: {
          message: '方案完成。',
          reasoning: '准备构建。',
          calls: [
            { name: 'update_requirement_brief', brief, request: null, confirmation: null },
            { name: 'submit_confirmation', brief: null, request: null, confirmation: confirmation(brief) },
          ],
        },
      }),
    ).toThrow('Route must be validated')
  })

  it('exposes registered modes and the freeform fallback policy', () => {
    const capabilities = playableCapabilitiesForAgent()
    expect(capabilities.plugin.modes).toHaveLength(4)
    expect(capabilities.routingPolicy.freeform).toContain('outside every registered mode')
  })
})
