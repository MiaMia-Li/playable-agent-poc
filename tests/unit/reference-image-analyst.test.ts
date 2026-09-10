import { describe, expect, it, vi } from 'vitest'
import {
  CodexCliReferenceImageAnalyst,
  OpenAIReferenceImageAnalyst,
  REFERENCE_IMAGE_ANALYSIS_MODEL,
  referenceImageAnalysisSchema,
  type ReferenceImageAnalysis,
} from '@/lib/playable/reference-image-analyst'

const analysis: ReferenceImageAnalysis = {
  version: 1,
  images: [
    {
      assetId: 'image-1',
      visualSummary: '竖屏卡通消除界面',
      layoutAndUi: ['顶部目标区', '中央棋盘'],
      visibleText: ['PLAY'],
      gameplayClues: ['点击相同图块'],
      uncertainties: ['无法确认失败条件'],
    },
  ],
  crossImageDirection: {
    visual: '明亮卡通风格',
    layoutAndUi: '保持顶部状态区和中央棋盘',
    gameplay: '围绕点击配对设计',
    uncertainties: ['结束流程未知'],
  },
}

describe('ReferenceImageAnalyst', () => {
  it('uses the qualified OpenRouter model identifier', () => {
    expect(REFERENCE_IMAGE_ANALYSIS_MODEL).toBe('openai/gpt-5.6-sol')
  })

  it('strictly rejects unknown fields in the deep output', () => {
    expect(
      referenceImageAnalysisSchema.safeParse({
        ...analysis,
        images: [{ ...analysis.images[0], filename: 'private.png' }],
      }).success,
    ).toBe(false)
  })

  it('passes image bytes to OpenAI Responses and validates the structured result', async () => {
    const generate = vi.fn(async () => ({ output: analysis }))
    const analyst = new OpenAIReferenceImageAnalyst({ generate })

    await expect(
      analyst.analyze({
        taskId: 'task-1',
        apiKey: 'sk-private',
        prompt: '参考图片制作试玩',
        images: [{ assetId: 'image-1', mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }],
      }),
    ).resolves.toEqual(analysis)

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ assetId: 'image-1', mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }],
      }),
    )
    expect(JSON.stringify(generate.mock.calls)).not.toContain('filename')
  })

  it('uses Codex CLI image attachments and removes its temporary files', async () => {
    const invoke = vi.fn(async (input: { images?: string[] }) => {
      expect(input.images).toHaveLength(1)
      return analysis
    })
    const analyst = new CodexCliReferenceImageAnalyst({ invoke })

    await expect(
      analyst.analyze({
        taskId: 'task-1',
        apiKey: 'local-auth',
        prompt: '参考图片制作试玩',
        images: [{ assetId: 'image-1', mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }],
      }),
    ).resolves.toEqual(analysis)

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ images: [expect.any(String)] }))
  })

  it.each([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
  ])('preserves the correct Codex CLI extension for %s', async (mimeType, extension) => {
    const invoke = vi.fn(async (input: { images?: string[] }) => {
      expect(input.images?.[0]).toMatch(new RegExp(`\\${extension}$`))
      return analysis
    })

    await new CodexCliReferenceImageAnalyst({ invoke }).analyze({
      taskId: 'task-1',
      apiKey: 'local-auth',
      prompt: '参考图片制作试玩',
      images: [{ assetId: 'image-1', mimeType, bytes: new Uint8Array([1, 2]) }],
    })
  })
})
