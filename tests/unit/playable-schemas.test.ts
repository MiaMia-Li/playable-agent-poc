import { describe, expect, it } from 'vitest'
import { confirmationProposalSchema, playableTaskPhases } from '@/lib/playable/schemas'
import { playableModeIds } from '@/lib/playable/types'

const validProposal = {
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
    expect(Object.keys(parsed)).toEqual(['mode', 'gameplay', 'resources', 'copy', 'storeUrl', 'delivery'])
    expect(Object.keys(parsed.resources)).toEqual([
      'tileFaces',
      'backgroundBoard',
      'animationEffects',
      'audio',
      'endCard',
    ])
  })

  it.each(playableModeIds)('accepts approved mode %s', (mode) => {
    expect(confirmationProposalSchema.parse({ ...validProposal, mode }).mode).toBe(mode)
  })

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

  it('requires an absolute HTTPS store URL without normalizing it', () => {
    expect(() => confirmationProposalSchema.parse({ ...validProposal, storeUrl: 'http://example.com/app' })).toThrow()
    expect(() => confirmationProposalSchema.parse({ ...validProposal, storeUrl: '/store/app' })).toThrow()
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

  it('rejects unknown fields at every contract boundary', () => {
    expect(() => confirmationProposalSchema.parse({ ...validProposal, custom: true })).toThrow()
    expect(() =>
      confirmationProposalSchema.parse({
        ...validProposal,
        copy: { ...validProposal.copy, subtitle: 'not allowed' },
      }),
    ).toThrow()
  })
})

describe('playable task phases', () => {
  it('publishes the complete lifecycle in order', () => {
    expect(playableTaskPhases).toEqual([
      'draft',
      'awaiting_confirmation',
      'building',
      'validating',
      'ready',
      'failed',
      'cancelled',
    ])
  })
})
