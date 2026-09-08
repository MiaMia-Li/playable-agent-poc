import { describe, expect, it, vi } from 'vitest'
import { generatePlayableMediaAssets } from '@/lib/playable/media-generation'
import type { ConfirmationProposal } from '@/lib/playable/schemas'

const confirmation: ConfirmationProposal = {
  routing: { match: 'exact', confidence: 1, differences: [] },
  mode: 'center_collision',
  gameplay: '相同牌向中心碰撞并消除',
  resources: {
    tileFaces: { status: '待生成', treatment: '生成农场动物牌面图集，透明背景' },
    backgroundBoard: { status: '内置默认', treatment: '使用默认背景' },
    animationEffects: { status: '内置默认', treatment: '使用默认特效' },
    audio: { status: '待生成', treatment: '活泼、友好的中文女声宣传配音' },
    endCard: { status: '内置默认', treatment: '使用默认结束卡' },
  },
  copy: { title: '欢乐农场', cta: '立即试玩', disclaimer: '', locale: 'zh-CN' },
  storeUrl: 'https://example.com/app',
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880,
  },
}

describe('playable AI media generation', () => {
  it('generates selected image and speech assets only after the build is confirmed', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/images/generations')) {
        return Response.json({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString('base64') }] })
      }
      return new Response(new Uint8Array([4, 5]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    })

    const assets = await generatePlayableMediaAssets(
      { taskId: 'task-1', apiKey: 'sk-test-only', confirmation },
      {
        fetch: fetchMock,
        generateId: (() => {
          let id = 0
          return () => `generated-${++id}`
        })(),
      },
    )

    expect(assets).toEqual([
      expect.objectContaining({ slot: 'tileFaces', filename: 'tileFaces-ai.png', bytes: new Uint8Array([1, 2, 3]) }),
      expect.objectContaining({ slot: 'audio', filename: 'audio-ai.mp3', bytes: new Uint8Array([4, 5]) }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const imageRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, string>
    expect(imageRequest).toMatchObject({
      model: 'gpt-image-2',
      background: 'transparent',
    })
    expect(imageRequest.prompt).toContain('欢乐农场')
    expect(imageRequest.prompt).toContain('相同牌向中心碰撞并消除')
    expect(imageRequest.prompt).toContain('生成农场动物牌面图集，透明背景')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      model: 'gpt-4o-mini-tts',
      input: '欢乐农场。立即试玩',
      instructions: '活泼、友好的中文女声宣传配音',
    })
  })
})
