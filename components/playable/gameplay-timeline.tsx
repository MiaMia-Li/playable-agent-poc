'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GameplayAnnotation, GameplayTimelineSegment, TimelineCorrection } from '@/lib/playable/schemas'

export type { TimelineCorrection }

type InputAction = NonNullable<GameplayTimelineSegment['playerInput']>['action']

const phaseLabels: Record<GameplayTimelineSegment['phase'], string> = {
  intro: '开场',
  tutorial: '教学',
  gameplay: '玩法',
  transition: '转场',
  result: '结算',
  end_card: '结束页',
}

const actionLabels: Record<InputAction, string> = {
  tap: '点击',
  long_press: '长按',
  swipe: '滑动',
  drag: '拖动',
  unknown: '操作',
}

/** Segments below this are highlighted so the user's attention goes there first. */
const LOW_CONFIDENCE = 0.6

/** Whole seconds: at one frame per second that is all the precision the model has. */
function formatClock(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Annotations attach to segments by time, not by id: a re-run re-segments the
 * video and would orphan any id, while the video's own timeline never moves.
 */
function overlaps(annotation: GameplayAnnotation, segment: GameplayTimelineSegment): boolean {
  return annotation.evidence.some(
    (evidence) => evidence.startSeconds <= segment.endSeconds && evidence.endSeconds >= segment.startSeconds,
  )
}

/**
 * The asset route streams without Range support, and a browser cannot seek a
 * video it cannot request ranges of. Holding the file as a Blob makes every
 * jump work, at the cost of downloading it once up front — which playback
 * without ranges needed anyway.
 */
function useSeekableVideo(url: string | undefined) {
  const [loaded, setLoaded] = useState<{ source: string; objectUrl?: string; failed?: boolean }>()
  useEffect(() => {
    if (!url || typeof URL.createObjectURL !== 'function') return
    let active = true
    let created: string | undefined
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Reference video request failed')
        return response.blob()
      })
      .then((blob) => {
        if (!active) return
        created = URL.createObjectURL(blob)
        setLoaded({ source: url, objectUrl: created })
      })
      .catch(() => {
        if (active) setLoaded({ source: url, failed: true })
      })
    return () => {
      active = false
      controller.abort()
      if (created) URL.revokeObjectURL(created)
    }
  }, [url])
  return loaded?.source === url ? loaded : undefined
}

function CorrectionForm({
  segment,
  onSubmit,
  onClose,
}: {
  segment: GameplayTimelineSegment
  onSubmit: (correction: TimelineCorrection) => Promise<boolean>
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [start, setStart] = useState(String(segment.startSeconds))
  const [end, setEnd] = useState(String(segment.endSeconds))
  const [submitting, setSubmitting] = useState(false)
  const startSeconds = Number(start)
  const endSeconds = Number(end)
  const valid =
    value.trim().length > 0 &&
    start.trim() !== '' &&
    end.trim() !== '' &&
    Number.isFinite(startSeconds) &&
    Number.isFinite(endSeconds) &&
    startSeconds >= 0 &&
    endSeconds >= startSeconds

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    const recorded = await onSubmit({ value: value.trim(), startSeconds, endSeconds })
    setSubmitting(false)
    if (recorded) onClose()
  }

  return (
    <form aria-label={`修正 ${formatClock(segment.startSeconds)} 这一段`} className="mt-2 space-y-2" onSubmit={submit}>
      <textarea
        aria-label="视频里实际发生的是"
        placeholder="视频里实际发生的是…"
        className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        rows={2}
        maxLength={1000}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          从
          <input
            type="number"
            aria-label="开始秒数"
            min={0}
            step={0.1}
            className="border-input bg-background w-16 rounded-md border px-1.5 py-0.5"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          秒
        </label>
        <label className="flex items-center gap-1">
          到
          <input
            type="number"
            aria-label="结束秒数"
            min={0}
            step={0.1}
            className="border-input bg-background w-16 rounded-md border px-1.5 py-0.5"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
          秒
        </label>
      </div>
      <p className="text-muted-foreground">这里只记录视频里客观发生了什么；想要改成什么样，请在对话里说。</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid || submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          记录标注
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          取消
        </Button>
      </div>
    </form>
  )
}

/**
 * The first-pass draft the user reviews segment by segment (spec section 7.6).
 * The user, watching at full frame rate, is the verifier the model cannot be:
 * inferred inputs and low-confidence segments are marked to draw the eye, a
 * click jumps the video to the segment, and a correction becomes an annotation
 * that sits beside the model's segment without rewriting it.
 */
export function GameplayTimeline({
  segments,
  annotations,
  videoUrl,
  onCorrect,
}: {
  segments: GameplayTimelineSegment[]
  annotations: GameplayAnnotation[]
  videoUrl?: string
  onCorrect?: (correction: TimelineCorrection) => Promise<boolean>
}) {
  const video = useSeekableVideo(videoUrl)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [correctingIndex, setCorrectingIndex] = useState<number>()

  const jump = (segment: GameplayTimelineSegment) => {
    const element = videoRef.current
    if (!element) return
    element.currentTime = segment.startSeconds
    void element.play()?.catch(() => undefined)
  }

  return (
    <section aria-label="玩法时间轴" className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">玩法时间轴</h2>
        <span className="text-muted-foreground text-xs">{segments.length} 段</span>
      </div>
      <p className="text-muted-foreground text-xs leading-5">
        这是模型看完视频后的草稿。模型每秒只看一帧，快速操作可能看错；点时间可以跳到那一段核对，看错的地方直接修正。
      </p>
      {videoUrl &&
        (video?.objectUrl ? (
          <video
            ref={videoRef}
            src={video.objectUrl}
            aria-label="参考视频"
            className="max-h-64 w-full rounded bg-black"
            controls
            preload="auto"
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            {video?.failed ? '参考视频载入失败，暂时无法跳转。' : '正在载入参考视频…'}
          </p>
        ))}
      <ol className="space-y-1.5">
        {segments.map((segment, index) => {
          const input = segment.playerInput
          const related = annotations.filter((annotation) => overlaps(annotation, segment))
          const lowConfidence = segment.confidence < LOW_CONFIDENCE
          return (
            <li
              key={`${segment.startSeconds}-${index}`}
              data-low-confidence={lowConfidence || undefined}
              className={`rounded-md border px-2 py-1.5 text-xs ${
                lowConfidence ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'bg-muted/40'
              }`}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-label={`跳到 ${formatClock(segment.startSeconds)}`}
                  className="text-primary disabled:text-muted-foreground shrink-0 font-mono tabular-nums hover:underline disabled:no-underline"
                  disabled={!video?.objectUrl}
                  onClick={() => jump(segment)}
                >
                  {formatClock(segment.startSeconds)}–{formatClock(segment.endSeconds)}
                </button>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">{phaseLabels[segment.phase]}</Badge>
                    {input ? (
                      <span className="font-medium">
                        {actionLabels[input.action]}「{input.target}」
                      </span>
                    ) : (
                      <span className="text-muted-foreground">无玩家输入</span>
                    )}
                    {input?.seenVia === 'ui_response' && (
                      <Badge variant="secondary" title="视频里看不到手指，这次输入是从游戏反应推断的">
                        推断
                      </Badge>
                    )}
                    {input?.seenVia === 'guide_hand' && <Badge variant="secondary">引导手势</Badge>}
                    {lowConfidence && <Badge variant="secondary">待核对</Badge>}
                  </p>
                  <p className="text-muted-foreground break-words">
                    {segment.screen}
                    {segment.response ? ` → ${segment.response}` : ''}
                  </p>
                  {segment.onScreenText && (
                    <p className="text-muted-foreground break-words">屏幕文字：{segment.onScreenText}</p>
                  )}
                  {segment.audioCue && <p className="text-muted-foreground break-words">声音：{segment.audioCue}</p>}
                  {related.map((annotation) => (
                    <p key={annotation.id} className="bg-primary/10 rounded px-1.5 py-0.5 break-words">
                      <span className="font-medium">以标注为准：</span>
                      {annotation.value}
                    </p>
                  ))}
                  {onCorrect && correctingIndex === index && (
                    <CorrectionForm
                      segment={segment}
                      onSubmit={onCorrect}
                      onClose={() => setCorrectingIndex(undefined)}
                    />
                  )}
                </div>
                {onCorrect && correctingIndex !== index && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-xs"
                    aria-label={`修正 ${formatClock(segment.startSeconds)} 这一段`}
                    onClick={() => setCorrectingIndex(index)}
                  >
                    修正
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
