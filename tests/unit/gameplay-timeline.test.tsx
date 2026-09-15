// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameplayTimeline } from '@/components/playable/gameplay-timeline'
import type { GameplayAnnotation, GameplayTimelineSegment } from '@/lib/playable/schemas'

const segments: GameplayTimelineSegment[] = [
  {
    startSeconds: 10,
    endSeconds: 11,
    phase: 'gameplay',
    screen: '选角界面',
    onScreenText: 'SELECT',
    playerInput: { action: 'tap', target: 'Cardiel', seenVia: 'ui_response' },
    response: 'Cardiel 被选中',
    audioCue: '',
    confidence: 0.8,
  },
  {
    startSeconds: 12,
    endSeconds: 13,
    phase: 'gameplay',
    screen: '选角界面',
    onScreenText: '',
    playerInput: { action: 'long_press', target: 'Oella', seenVia: 'touch_indicator' },
    response: 'Oella 被选中',
    audioCue: '',
    confidence: 0.4,
  },
  {
    startSeconds: 14,
    endSeconds: 16,
    phase: 'transition',
    screen: '进入战斗',
    onScreenText: '',
    playerInput: null,
    response: '',
    audioCue: '',
    confidence: 0.9,
  },
]

const annotation: GameplayAnnotation = {
  id: 'annotation-1',
  assetId: 'video-1',
  source: 'user',
  value: '12 秒是点击，不是长按',
  evidence: [{ startSeconds: 12, endSeconds: 12.5, observation: '点击' }],
  confidence: 1,
  origin: 'timeline',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('gameplay timeline', () => {
  // The marks exist to steer the user towards what the model could not see.
  it('marks inferred inputs and low-confidence segments', () => {
    render(<GameplayTimeline segments={segments} annotations={[]} />)
    const rows = screen.getAllByRole('listitem')

    expect(within(rows[0]).getByText('点击「Cardiel」')).toBeInTheDocument()
    expect(within(rows[0]).getByText('推断')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('待核对')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('待核对')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('推断')).not.toBeInTheDocument()
    expect(within(rows[2]).getByText('无玩家输入')).toBeInTheDocument()
  })

  it('shows an annotation under every segment it overlaps, beside the model text', () => {
    render(<GameplayTimeline segments={segments} annotations={[annotation]} />)
    const rows = screen.getAllByRole('listitem')

    expect(within(rows[1]).getByText(/12 秒是点击，不是长按/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('长按「Oella」')).toBeInTheDocument()
    expect(within(rows[0]).queryByText(/12 秒是点击/)).not.toBeInTheDocument()
    expect(within(rows[2]).queryByText(/12 秒是点击/)).not.toBeInTheDocument()
  })

  it('records a correction with the segment range prefilled and editable', async () => {
    const onCorrect = vi.fn(async () => true)
    render(<GameplayTimeline segments={segments} annotations={[]} onCorrect={onCorrect} />)

    fireEvent.click(screen.getByRole('button', { name: '修正 00:12 这一段' }))
    const form = screen.getByRole('form', { name: '修正 00:12 这一段' })
    expect(within(form).getByLabelText('开始秒数')).toHaveValue(12)
    expect(within(form).getByRole('button', { name: '记录标注' })).toBeDisabled()

    fireEvent.change(within(form).getByLabelText('视频里实际发生的是'), { target: { value: '这是点击，不是长按' } })
    fireEvent.change(within(form).getByLabelText('结束秒数'), { target: { value: '12.5' } })
    fireEvent.click(within(form).getByRole('button', { name: '记录标注' }))

    await waitFor(() =>
      expect(onCorrect).toHaveBeenCalledWith({ value: '这是点击，不是长按', startSeconds: 12, endSeconds: 12.5 }),
    )
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  })

  // Closing on failure would throw away what the user typed.
  it('keeps the correction open when it was not stored', async () => {
    const onCorrect = vi.fn(async () => false)
    render(<GameplayTimeline segments={segments} annotations={[]} onCorrect={onCorrect} />)

    fireEvent.click(screen.getByRole('button', { name: '修正 00:10 这一段' }))
    const form = screen.getByRole('form', { name: '修正 00:10 这一段' })
    fireEvent.change(within(form).getByLabelText('视频里实际发生的是'), { target: { value: '没有点击' } })
    fireEvent.click(within(form).getByRole('button', { name: '记录标注' }))

    await waitFor(() => expect(onCorrect).toHaveBeenCalled())
    expect(within(form).getByLabelText('视频里实际发生的是')).toHaveValue('没有点击')
  })

  // The asset route has no Range support, so the video is held as a Blob;
  // jumping is only offered once it is there.
  it('jumps the video to a segment once the video has loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' }))),
    )
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:reference') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    try {
      render(<GameplayTimeline segments={segments} annotations={[]} videoUrl="/api/playable-tasks/t/assets/video-1" />)
      const jump = screen.getByRole('button', { name: '跳到 00:12' })
      expect(jump).toBeDisabled()

      const video = (await screen.findByLabelText('参考视频')) as HTMLVideoElement
      await waitFor(() => expect(jump).toBeEnabled())
      fireEvent.click(jump)

      expect(video.currentTime).toBe(12)
      expect(play).toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })
})
