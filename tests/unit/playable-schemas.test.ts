import { describe, expect, it } from 'vitest'
import {
  confirmationProposalSchema,
  parsePlayableAgentOutput,
  playableAgentReplySchema,
  playableTaskPhases,
} from '@/lib/playable/schemas'

const validProposal = {
  routing: { match: 'approximate', confidence: 0.84, differences: ['奖励表现使用模板默认效果'] },
  mode: 'center_collision',
  gameplay: '相同牌向中心碰撞、破碎并计分',
  resources: {
    tileFaces: { status: '用户上传', treatment: '使用 uploads/tiles.png 作为牌面图集' },
    backgroundBoard: { status: '内置默认', treatment: '使用模式默认背景、棋盘与 HUD' },
    animationEffects: { status: '待生成', treatment: '生成已批准的中心碰撞粒子效果' },
    audio: { status: '待上传', treatment: '等待上传 MP3 背景音乐' },
    endCard: { status: '内置默认', treatment: '使用内置结束卡素材' },
  },
  copy: {
    title: 'Mahjong Match',
    cta: '立即下载',
    disclaimer: '演示内容仅供参考',
    locale: 'zh-CN',
  },
  storeUrl: 'https://play.google.com/store/apps/details?id=com.example.mahjong&referrer=utm_source%3Dplayable',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
} as const

describe('confirmation proposal schema', () => {
  it('accepts all nine consolidated confirmation categories and preserves the exact store URL', () => {
    const parsed = confirmationProposalSchema.parse(validProposal)

    expect(parsed).toEqual(validProposal)
    expect(parsed.storeUrl).toBe(validProposal.storeUrl)
    expect(Object.keys(parsed)).toEqual(['routing', 'mode', 'gameplay', 'resources', 'copy', 'storeUrl', 'delivery'])
    expect(Object.keys(parsed.resources)).toEqual([
      'tileFaces',
      'backgroundBoard',
      'animationEffects',
      'audio',
      'endCard',
    ])
  })

  it('upgrades persisted pre-Plugin confirmations with an exact routing default', () => {
    const { routing: _routing, ...legacyProposal } = validProposal
    void _routing

    expect(confirmationProposalSchema.parse(legacyProposal).routing).toEqual({
      match: 'exact',
      confidence: 1,
      differences: [],
    })
  })

  it.each(['center_collision', 'top_rack', 'gravity_fill', 'perspective_3d'] as const)(
    'accepts approved mode %s',
    (mode) => {
      expect(confirmationProposalSchema.parse({ ...validProposal, mode }).mode).toBe(mode)
    },
  )

  it.each(['用户上传', '内置默认', '待上传', '待生成'] as const)('accepts resource status %s', (status) => {
    const proposal = {
      ...validProposal,
      resources: {
        ...validProposal.resources,
        tileFaces: { status, treatment: '明确的素材处理方式' },
      },
    }

    expect(confirmationProposalSchema.parse(proposal).resources.tileFaces.status).toBe(status)
  })

  it.each(['custom', 'unknown'])('rejects unsupported mode %s', (mode) => {
    expect(() => confirmationProposalSchema.parse({ ...validProposal, mode })).toThrow()
  })

  it('requires a non-empty treatment for every resource', () => {
    const proposal = {
      ...validProposal,
      resources: {
        ...validProposal.resources,
        audio: { status: '待上传', treatment: '' },
      },
    }

    expect(() => confirmationProposalSchema.parse(proposal)).toThrow()
  })

  it.each([
    ['relative', '/store/app'],
    ['malformed', 'not a url'],
    ['HTTP', 'http://example.com/app'],
  ])('returns a Zod failure without throwing for a %s store URL', (_case, storeUrl) => {
    expect(() => confirmationProposalSchema.safeParse({ ...validProposal, storeUrl })).not.toThrow()
    expect(confirmationProposalSchema.safeParse({ ...validProposal, storeUrl }).success).toBe(false)
  })

  it('accepts and preserves a valid HTTPS store URL through safeParse', () => {
    const result = confirmationProposalSchema.safeParse(validProposal)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.storeUrl).toBe(validProposal.storeUrl)
    }
  })

  it.each([
    ['network', 'other'],
    ['logicalWidth', 720],
    ['logicalHeight', 1280],
    ['output', 'zip'],
    ['maxBytes', 5242881],
  ] as const)('rejects an invalid delivery %s', (field, value) => {
    const proposal = {
      ...validProposal,
      delivery: { ...validProposal.delivery, [field]: value },
    }

    expect(() => confirmationProposalSchema.parse(proposal)).toThrow()
  })

  it.each([
    ['root', { ...validProposal, unknown: true }],
    ['resources', { ...validProposal, resources: { ...validProposal.resources, unknown: true } }],
    ['copy', { ...validProposal, copy: { ...validProposal.copy, unknown: true } }],
    ['delivery', { ...validProposal, delivery: { ...validProposal.delivery, unknown: true } }],
  ])('rejects unknown keys at the %s boundary', (_boundary, proposal) => {
    expect(confirmationProposalSchema.safeParse(proposal).success).toBe(false)
  })

  it.each(['tileFaces', 'backgroundBoard', 'animationEffects', 'audio', 'endCard'] as const)(
    'rejects unknown keys in the %s resource object',
    (resource) => {
      const proposal = {
        ...validProposal,
        resources: {
          ...validProposal.resources,
          [resource]: { ...validProposal.resources[resource], unknown: true },
        },
      }

      expect(confirmationProposalSchema.safeParse(proposal).success).toBe(false)
    },
  )
})

describe('playable agent reply schema', () => {
  it('accepts a clarification with user-selectable actions', () => {
    const reply = {
      kind: 'clarification',
      message: '你希望使用哪一种核心玩法？',
      reasoning: '目前只知道农场主题，还没有足够信息确定消除机制。',
      options: [
        { id: 'center_collision', label: '中心碰撞', description: '配对后向中心碰撞消除', value: '选择中心碰撞玩法' },
        { id: 'top_rack', label: '上方牌架', description: '选牌进入牌架后配对', value: '选择上方牌架玩法' },
      ],
    } as const

    expect(playableAgentReplySchema.parse(reply)).toEqual(reply)
  })

  it('accepts a confirmation with a visible assistant summary', () => {
    const reply = {
      kind: 'confirmation',
      message: '方案已经整理完成，你还可以调整素材来源。',
      reasoning: '用户已经明确选择中心碰撞玩法。',
      confirmation: validProposal,
    } as const

    expect(playableAgentReplySchema.parse(reply)).toEqual(reply)
  })

  it('returns a structured Plugin request when the state machine is unsupported', () => {
    expect(
      parsePlayableAgentOutput({
        kind: 'plugin_request',
        message: '需要新增 Plugin。',
        reasoning: '核心状态机不受支持。',
        options: [],
        confirmation: null,
        pluginRequest: {
          summary: '跑酷玩法',
          reason: '不是配对消除状态机',
          requiredStateMachine: ['移动', '障碍碰撞', '失败重开'],
          source: 'text-description',
        },
      }),
    ).toMatchObject({ kind: 'plugin_request', pluginRequest: { summary: '跑酷玩法' } })
  })
})

describe('playable task phases', () => {
  it('publishes the complete lifecycle in order', () => {
    expect(playableTaskPhases).toEqual([
      'draft',
      'awaiting_confirmation',
      'building',
      'validating',
      'reviewing',
      'ready',
      'needs_plugin',
      'failed',
      'cancelled',
    ])
  })
})
