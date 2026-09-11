import { describe, expect, it } from 'vitest'
import type { ConfirmationProposal } from '@/lib/playable/schemas'
import {
  createAssetSourceManifest,
  createProductionConfig,
  createValidationReport,
} from '@/lib/playable/production-contract'
import { deliveryProfileSnapshot } from '@/lib/playable/delivery-standards'
import { MAHJONG_PLAYABLE_PLUGIN } from '@/lib/playable/template-registry'

const confirmation: ConfirmationProposal = {
  routing: { match: 'approximate', confidence: 0.82, differences: ['镜头运镜使用模板默认方案'] },
  mode: 'perspective_3d',
  gameplay: '逐层移除可见顶面并揭示下层',
  resources: {
    tileFaces: { status: '用户上传', treatment: '使用已上传牌面' },
    backgroundBoard: { status: '内置默认', treatment: '使用 Plugin 默认背景' },
    animationEffects: { status: '待生成', treatment: '生成金色破碎效果' },
    audio: { status: '内置默认', treatment: '使用 Plugin 默认音频' },
    endCard: { status: '内置默认', treatment: '使用 Plugin 默认结束卡' },
  },
  copy: { title: '麻将纵深挑战', cta: '立即试玩', disclaimer: '广告演示', locale: 'zh-CN' },
  storeUrl: 'https://example.com/app',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

describe('playable production contract', () => {
  it('projects one confirmation into the five documented config groups with Plugin versions', () => {
    const config = createProductionConfig(confirmation)

    expect(Object.keys(config)).toEqual(['core', 'theme', 'assets', 'ad', 'copy'])
    expect(config.core).toMatchObject({
      pluginId: 'mahjong-pair-match-playable',
      pluginVersion: '1.2.0',
      runtimeVersion: '2',
      mode: 'perspective_3d',
      routing: confirmation.routing,
    })
    expect(config.ad).toMatchObject({ orientation: 'responsive', storeUrl: confirmation.storeUrl })
  })

  it('records every asset slot source and actual file without task storage keys', () => {
    const manifest = createAssetSourceManifest(confirmation, [
      {
        id: 'asset-1',
        slot: 'tileFaces',
        filename: 'tiles.png',
        mimeType: 'image/png',
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      },
    ])

    expect(manifest.plugin).toEqual({ id: 'mahjong-pair-match-playable', version: '1.2.0', runtimeVersion: '2' })
    expect(manifest.sources).toHaveLength(5)
    expect(manifest.sources[0]).toMatchObject({ origin: 'task-upload', files: ['tiles.png'] })
    expect(JSON.stringify(manifest)).not.toContain('users/')
  })

  it('publishes an explicit pass report for every automated gate', () => {
    const report = createValidationReport({ bytes: 1024, offlineResources: true, responsiveViewport: true })

    expect(report.passed).toBe(true)
    expect(report.buildPassed).toBe(true)
    expect(report.deliveryCompliant).toBe(true)
    expect(Object.values(report.gates)).not.toContain('failed')
    expect(report.plugin).toEqual({
      id: MAHJONG_PLAYABLE_PLUGIN.id,
      version: MAHJONG_PLAYABLE_PLUGIN.version,
      runtimeVersion: MAHJONG_PLAYABLE_PLUGIN.runtimeVersion,
    })
  })

  it('treats an AppLovin artifact exactly at 5 MiB as compliant', () => {
    const report = createValidationReport({
      bytes: MAHJONG_PLAYABLE_PLUGIN.delivery.maxBytes,
      offlineResources: true,
      responsiveViewport: true,
      delivery: deliveryProfileSnapshot('applovin'),
    })

    expect(report.passed).toBe(true)
    expect(report.buildPassed).toBe(true)
    expect(report.deliveryCompliant).toBe(true)
    expect(report.gates.packageSize).toBe('passed')
  })

  it('keeps an oversized AppLovin build usable while reporting package noncompliance', () => {
    const report = createValidationReport({
      bytes: MAHJONG_PLAYABLE_PLUGIN.delivery.maxBytes + 1,
      offlineResources: true,
      responsiveViewport: true,
      delivery: deliveryProfileSnapshot('applovin'),
    })

    expect(report.passed).toBe(true)
    expect(report.buildPassed).toBe(true)
    expect(report.deliveryCompliant).toBe(false)
    expect(report.gates.packageSize).toBe('failed')
  })

  it('does not apply a channel size gate to generic single-HTML delivery', () => {
    const report = createValidationReport({
      bytes: 20 * 1024 * 1024,
      offlineResources: true,
      responsiveViewport: true,
      delivery: deliveryProfileSnapshot('generic_single_html'),
    })

    expect(report.passed).toBe(true)
    expect(report.deliveryCompliant).toBe(true)
    expect(report.gates.packageSize).toBe('not_applicable')
  })

  it('still fails the build when a hard runtime gate fails', () => {
    const report = createValidationReport({
      bytes: 1024,
      offlineResources: true,
      responsiveViewport: false,
    })

    expect(report.passed).toBe(false)
    expect(report.buildPassed).toBe(false)
  })
})
